// ====================================================
// ApiService — reemplaza completamente SheetsService
// Se comunica con el Cloudflare Worker backend
// ====================================================

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, take } from 'rxjs';
import { Auth, user } from '@angular/fire/auth';
import { environment } from '../../../environments/environment';
import { CotizacionItem } from './calculator.service';
import Swal from 'sweetalert2';

export interface CotizacionSheet {
  fecha: string;
  referenciaInterna: string;
  tipoActo: string;
  moneda: string;
  cantidadInmuebles: number;
  costoNotarial: number;
  costoRegistral: number;
  totalPagar: number;
  notaria?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private readonly baseUrl = environment.workerUrl;

  constructor() {
    this.initIndexedDB();
    // Sincronizar automáticamente cuando vuelve internet
    window.addEventListener('online', () => this.syncOfflineData());
  }

  // -------------------------------------------------------
  // Auth: obtiene el Firebase ID Token del usuario actual
  // Se renueva automáticamente por el SDK — sin SweetAlerts de expiración
  // -------------------------------------------------------
  private async getAuthHeaders(): Promise<HttpHeaders> {
    const currentUser = await firstValueFrom(user(this.auth).pipe(take(1)));
    if (!currentUser) throw new Error('No hay usuario autenticado');

    // getIdToken() renueva el token automáticamente si está por expirar
    const token = await currentUser.getIdToken();
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
  }

  // -------------------------------------------------------
  // Guardar una sola cotización
  // -------------------------------------------------------
  async saveCotizacion(data: CotizacionSheet): Promise<void> {
    if (!navigator.onLine) {
      await this.saveOffline(data);
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 3500,
        icon: 'info', title: 'Sin conexión',
        text: 'Cotización respaldada localmente. Se sincronizará al reconectar.'
      });
      return;
    }

    try {
      const headers = await this.getAuthHeaders();
      await firstValueFrom(
        this.http.post(`${this.baseUrl}/api/cotizaciones`, data, { headers })
      );
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success', title: '¡Guardado exitosamente en Google Sheets!'
      });
    } catch (error: any) {
      console.error('Error guardando cotización en el Worker:', error);
      // Guardar offline como fallback ante cualquier error de red
      try {
        await this.saveOffline(data);
        Swal.fire({
          toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
          icon: 'warning', title: 'Error de red',
          text: 'Guardado localmente como respaldo. Se sincronizará luego.'
        });
      } catch (offlineError) {
        console.error('Error guardando offline:', offlineError);
        Swal.fire('Error', 'No pudimos guardar la cotización. Revisa tu conexión.', 'error');
      }
    }
  }

  // -------------------------------------------------------
  // Guardar múltiples ítems del carrito (agrupados en una fila)
  // -------------------------------------------------------
  async saveCotizacionMulti(
    items: CotizacionItem[],
    refGlobal: string = '',
    notariaName: string = ''
  ): Promise<void> {
    if (!items.length) return;

    const data: CotizacionSheet = {
      fecha: new Date().toISOString(),
      referenciaInterna: refGlobal,
      tipoActo: items.map(it => it.acto.nombre).join(' + '),
      moneda: items[0].moneda,
      cantidadInmuebles: items.reduce((s, it) => s + it.cantidadInmuebles, 0),
      costoNotarial: items.reduce((s, it) => s + it.costoNotarialFinal, 0),
      costoRegistral: items.reduce((s, it) => s + it.costoRegistralFinal, 0),
      totalPagar: items.reduce((s, it) => s + it.totalFinal, 0),
      notaria: notariaName,
    };

    return this.saveCotizacion(data);
  }

  // -------------------------------------------------------
  // Obtener historial paginado desde el Worker
  // -------------------------------------------------------
  async getHistorial(
    limit: number = 100,
    offset: number = 0
  ): Promise<{ data: CotizacionSheet[]; hasMore: boolean }> {
    if (!navigator.onLine) {
      return { data: await this.getOfflineData(), hasMore: false };
    }

    try {
      const headers = await this.getAuthHeaders();
      return await firstValueFrom(
        this.http.get<{ data: CotizacionSheet[]; hasMore: boolean }>(
          `${this.baseUrl}/api/historial?limit=${limit}&offset=${offset}`,
          { headers }
        )
      );
    } catch (error: any) {
      console.error('Error obteniendo historial:', error);
      return { data: await this.getOfflineData(), hasMore: false };
    }
  }

  // -------------------------------------------------------
  // IndexedDB — fallback offline (misma lógica que SheetsService)
  // -------------------------------------------------------
  private initIndexedDB(): void {
    try {
      const request = indexedDB.open('CotizadorDB', 1);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('cotizaciones_offline')) {
          db.createObjectStore('cotizaciones_offline', { autoIncrement: true });
        }
      };
      request.onerror = () => {
        console.warn('No se pudo inicializar IndexedDB (modo incógnito o sin permisos)');
      };
    } catch (e) {
      console.warn('Error abriendo IndexedDB:', e);
    }
  }

  private saveOffline(data: CotizacionSheet): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open('CotizadorDB', 1);
        request.onupgradeneeded = (event: any) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('cotizaciones_offline')) {
            db.createObjectStore('cotizaciones_offline', { autoIncrement: true });
          }
        };
        request.onsuccess = (event: any) => {
          try {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('cotizaciones_offline')) {
              reject(new Error('Store no existe'));
              return;
            }
            const tx = db.transaction('cotizaciones_offline', 'readwrite');
            const store = tx.objectStore('cotizaciones_offline');
            store.add(data);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          } catch (e) {
            reject(e);
          }
        };
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  private getOfflineData(): Promise<CotizacionSheet[]> {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open('CotizadorDB', 1);
        request.onsuccess = (event: any) => {
          try {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('cotizaciones_offline')) {
              resolve([]);
              return;
            }
            const tx = db.transaction('cotizaciones_offline', 'readonly');
            const getAllReq = tx.objectStore('cotizaciones_offline').getAll();
            getAllReq.onsuccess = () => resolve(getAllReq.result || []);
            getAllReq.onerror = () => resolve([]);
          } catch {
            resolve([]);
          }
        };
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  private async syncOfflineData(): Promise<void> {
    const offlineData = await this.getOfflineData();
    if (!offlineData.length) return;

    let allSynced = true;
    for (const record of offlineData) {
      try {
        const headers = await this.getAuthHeaders();
        await firstValueFrom(
          this.http.post(`${this.baseUrl}/api/cotizaciones`, record, { headers })
        );
      } catch (e) {
        console.error('Error sincronizando registro offline:', e);
        allSynced = false;
        break; // Si falla uno, paramos y lo intentaremos la próxima vez
      }
    }

    if (allSynced) {
      // Limpiar IndexedDB si todo se subió correctamente
      const request = indexedDB.open('CotizadorDB', 1);
      request.onsuccess = (event: any) => {
        const db = event.target.result;
        if (db.objectStoreNames.contains('cotizaciones_offline')) {
          db.transaction('cotizaciones_offline', 'readwrite')
            .objectStore('cotizaciones_offline')
            .clear();
        }
      };
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success', title: 'Cotizaciones sincronizadas con Google Sheets'
      });
    }
  }
}
