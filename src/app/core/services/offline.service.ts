/**
 * offline.service.ts
 *
 * Maneja la creación automática, vinculación y guardado directo de cotizaciones
 * en Google Sheets (usando el Google OAuth token del usuario) con persistencia
 * y sincronización offline mediante IndexedDB (CotizadorDB).
 *
 * Flujo idéntico al probado en CotizadorNotariaCruzado:
 * 1. Si hay conexión y token de Google:
 *    - Busca si ya existe la hoja "Cotizaciones Notariales" en Google Drive del abogado.
 *    - Si no existe, la crea con sus encabezados en el Google Drive del abogado.
 *    - Registra el spreadsheetId en Firestore para que el panel de administración lo vea.
 *    - Inserta las filas de cotización directamente en Google Sheets.
 * 2. Si no hay conexión o no hay token:
 *    - Respalda en IndexedDB (cotizaciones_offline).
 *    - Al recuperar conexión e iniciar sesión, sincroniza automáticamente.
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiService, CotizacionPayload } from './api.service';
import Swal from 'sweetalert2';

const DB_NAME    = 'CotizadorDB';
const DB_VERSION = 1;
const STORE_NAME = 'cotizaciones_offline';
const FILE_NAME  = 'Cotizaciones Notariales';
const SERVICE_ACCOUNT_EMAIL = 'cotizador-backend@cotizacionesnotariales.iam.gserviceaccount.com';

@Injectable({
  providedIn: 'root'
})
export class OfflineService {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase | null>;
  private spreadsheetId: string | null = null;

  constructor(
    private http: HttpClient,
    private authSvc: AuthService,
    private apiSvc: ApiService
  ) {
    this.dbPromise = this.initIndexedDB();
    window.addEventListener('online', () => this.syncOfflineData());
  }

  private getToken(): string | null {
    return this.authSvc.getGoogleOAuthToken();
  }

  private getGoogleHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.getToken()}`,
      'Content-Type': 'application/json'
    });
  }

  // ─── IndexedDB setup ───────────────────────────────────────────────────

  private initIndexedDB(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event: any) => {
          const db = event.target.result as IDBDatabase;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { autoIncrement: true });
          }
        };

        request.onsuccess = (event: any) => {
          this.db = event.target.result as IDBDatabase;
          resolve(this.db);
        };

        request.onerror = (event: any) => {
          console.error('[OfflineService] IndexedDB error:', event.target.error);
          resolve(null);
        };
      } catch (e) {
        console.error('[OfflineService] Failed to open IndexedDB:', e);
        resolve(null);
      }
    });
  }

  private async saveToIndexedDB(items: CotizacionPayload[]): Promise<void> {
    const db = this.db || await this.dbPromise;
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add(items);
  }

  private async deleteFromIndexedDB(key: IDBValidKey): Promise<void> {
    const db = this.db || await this.dbPromise;
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
  }

  async getAllOfflineData(): Promise<{ key: IDBValidKey; value: CotizacionPayload[] }[]> {
    const db = this.db || await this.dbPromise;
    return new Promise((resolve, reject) => {
      if (!db) return resolve([]);

      const tx    = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const results: { key: IDBValidKey; value: CotizacionPayload[] }[] = [];

      const req = store.openCursor();
      req.onsuccess = (event: any) => {
        const cursor = event.target.result as IDBCursorWithValue | null;
        if (cursor) {
          results.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ─── Google Sheets Provisioning & Writing ──────────────────────────────

  /**
   * Obtiene o crea la hoja de cálculo en el Google Drive del abogado.
   */
  async initializeSpreadsheet(): Promise<string> {
    if (this.spreadsheetId) return this.spreadsheetId;

    // Verificar si el contexto ya tiene un spreadsheetId asignado
    const cachedId = this.apiSvc.getSpreadsheetId();
    if (cachedId) {
      this.spreadsheetId = cachedId;
      return cachedId;
    }

    const token = this.getToken();
    if (!token) throw new Error('No Google OAuth token available');

    const headers = this.getGoogleHeaders();

    // 1. Buscar si ya existe la hoja en Google Drive del usuario
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(FILE_NAME)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const searchRes: any = await firstValueFrom(this.http.get(searchUrl, { headers }));

    if (searchRes.files && searchRes.files.length > 0) {
      this.spreadsheetId = searchRes.files[0].id as string;
      // Guardar en Firestore para que el panel de administración lo reconozca
      await this.apiSvc.saveSpreadsheetId(this.spreadsheetId);
      return this.spreadsheetId;
    }

    // 2. Si no existe, crear la hoja en Google Drive del usuario
    const notariaName = this.authSvc.currentContext?.perfil?.nombre_oficial || 'Cotizador Notarial';
    const createUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
    const body = {
      properties: { title: `${FILE_NAME} — ${notariaName}` }
    };
    const createRes: any = await firstValueFrom(this.http.post(createUrl, body, { headers }));
    const newId = createRes.spreadsheetId as string;
    this.spreadsheetId = newId;

    // 3. Insertar las cabeceras estándar en la fila 1
    const headersList = [
      'Fecha',
      'Referencia Interna',
      'Tipo de Acto',
      'Moneda',
      'Cantidad Bienes',
      'Costo Notarial',
      'Costo Registral',
      'Total a Pagar',
      'Notaría'
    ];
    const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${newId}/values/A1:append?valueInputOption=USER_ENTERED`;
    await firstValueFrom(this.http.post(headerUrl, { values: [headersList] }, { headers }));

    // 4. Compartir con la Service Account de Google Cloud (acceso opcional de soporte)
    try {
      await firstValueFrom(
        this.http.post(
          `https://www.googleapis.com/drive/v3/files/${newId}/permissions?sendNotificationEmail=false`,
          {
            type: 'user',
            role: 'writer',
            emailAddress: SERVICE_ACCOUNT_EMAIL
          },
          { headers }
        )
      );
    } catch (e) {
      console.warn('[OfflineService] No se pudo compartir con la Service Account (no crítico):', e);
    }

    // 5. Guardar el ID en Firestore para el panel de administración
    await this.apiSvc.saveSpreadsheetId(newId);

    return newId;
  }

  private async appendRows(items: CotizacionPayload[]): Promise<void> {
    const sheetId = await this.initializeSpreadsheet();
    const notariaName = this.authSvc.currentContext?.perfil?.nombre_oficial || '';

    const values = items.map((r) => [
      r.fecha,
      r.referenciaInterna,
      r.tipoActo,
      r.moneda,
      r.cantidadBienes.toString(),
      r.costoNotarial.toString(),
      r.costoRegistral.toString(),
      r.totalPagar.toString(),
      notariaName
    ]);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=USER_ENTERED`;
    await firstValueFrom(
      this.http.post(url, { values }, { headers: this.getGoogleHeaders() })
    );
  }

  // ─── Save (online or offline) ──────────────────────────────────────────

  /**
   * Guarda cotizaciones en Google Sheets.
   * Si está offline o falla la conexión, las respalda en IndexedDB.
   */
  async saveCotizaciones(items: CotizacionPayload[]): Promise<void> {
    const token = this.getToken();

    if (!navigator.onLine || !token) {
      await this.saveToIndexedDB(items);
      if (!token) {
        const result = await Swal.fire({
          title: 'Sesión de Google Requerida',
          text: 'Se respaldó localmente. Para guardar en Google Sheets, por favor renueva tus permisos de Google.',
          icon: 'info',
          showCancelButton: true,
          confirmButtonText: 'Conectar Google Sheets',
          cancelButtonText: 'Guardar sólo local',
          confirmButtonColor: '#125B18'
        });

        if (result.isConfirmed) {
          const nuevoToken = await this.authSvc.renovarSesionGoogle();
          if (nuevoToken) {
            return this.saveCotizaciones(items);
          }
        }
      } else {
        Swal.fire({
          toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
          icon: 'info', title: 'Respaldado localmente', text: 'Se sincronizará cuando vuelva el internet.'
        });
      }
      return;
    }

    try {
      await this.appendRows(items);
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success', title: '¡Guardado exitosamente en Google Sheets!'
      });
    } catch (error: any) {
      console.error('[OfflineService] Error en Sheets API:', error);

      if (error?.status === 401) {
        const result = await Swal.fire({
          title: 'Sesión Expirada',
          text: 'Tu sesión de Google expiró por seguridad (dura 1 hora). ¿Deseas reconectar ahora para guardar en la nube?',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Sí, reconectar',
          cancelButtonText: 'No, gracias',
          confirmButtonColor: '#125B18'
        });

        if (result.isConfirmed) {
          const nuevoToken = await this.authSvc.renovarSesionGoogle();
          if (nuevoToken) {
            try {
              await this.appendRows(items);
              Swal.fire({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
                icon: 'success', title: 'Sesión renovada y guardado exitosamente'
              });
              return;
            } catch (retryError) {
              console.error('[OfflineService] Fallo tras renovar sesión:', retryError);
            }
          }
        }
      }

      await this.saveToIndexedDB(items);
      Swal.fire('Guardado Local', 'Se ha respaldado localmente y se intentará subir luego.', 'info');
    }
  }

  // ─── Sync ──────────────────────────────────────────────────────────────

  async syncOfflineData(): Promise<void> {
    const token = this.getToken();
    if (!token || !navigator.onLine) return;

    const pendingGroups = await this.getAllOfflineData();
    if (pendingGroups.length === 0) return;

    console.log(`[OfflineService] Syncing ${pendingGroups.length} pending group(s)...`);

    let syncedCount = 0;
    for (const group of pendingGroups) {
      try {
        await this.appendRows(group.value);
        await this.deleteFromIndexedDB(group.key);
        syncedCount++;
      } catch (e) {
        console.warn('[OfflineService] Sync halted due to error on item:', e);
        break;
      }
    }

    if (syncedCount > 0) {
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
        icon: 'success',
        title: 'Sincronizado',
        text: `${syncedCount} cotización(es) offline sincronizada(s) con Google Sheets.`
      });
    }
  }
}
