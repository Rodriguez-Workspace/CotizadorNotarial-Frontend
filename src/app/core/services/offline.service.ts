/**
 * offline.service.ts
 *
 * Maneja la persistencia offline de cotizaciones usando IndexedDB.
 * Cuando el dispositivo recupera conectividad, sincroniza automáticamente
 * las cotizaciones pendientes con el Worker (via ApiService).
 *
 * Extraído del SheetsService original — la lógica IndexedDB es idéntica.
 */

import { Injectable } from '@angular/core';
import { ApiService, CotizacionPayload } from './api.service';
import Swal from 'sweetalert2';

const DB_NAME    = 'CotizadorDB';
const DB_VERSION = 1;
const STORE_NAME = 'cotizaciones_offline';

@Injectable({
  providedIn: 'root'
})
export class OfflineService {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase | null>;

  constructor(private apiSvc: ApiService) {
    this.dbPromise = this.initIndexedDB();
    window.addEventListener('online', () => this.syncOfflineData());
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

  private async getAllOfflineData(): Promise<{ key: IDBValidKey; value: CotizacionPayload[] }[]> {
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

  // ─── Save (online or offline) ──────────────────────────────────────────

  /**
   * Intenta guardar cotizaciones en el Worker.
   * Si el dispositivo está offline, las persiste en IndexedDB.
   */
  async saveCotizaciones(items: CotizacionPayload[]): Promise<void> {
    if (!navigator.onLine) {
      await this.saveToIndexedDB(items);
      Swal.fire('Guardado Local', 'Se ha respaldado localmente y se intentará subir luego.', 'info');
      return;
    }

    try {
      await this.apiSvc.saveCotizacion(items);
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success', title: '¡Guardado exitosamente en Google Sheets!'
      });
    } catch (e) {
      // Save locally as fallback if the API call fails
      await this.saveToIndexedDB(items);
      Swal.fire('Guardado Local', 'Se ha respaldado localmente y se intentará subir luego.', 'info');
    }
  }

  // ─── Sync ──────────────────────────────────────────────────────────────

  async syncOfflineData(): Promise<void> {
    const pendingGroups = await this.getAllOfflineData();
    if (pendingGroups.length === 0) return;

    console.log(`[OfflineService] Syncing ${pendingGroups.length} pending group(s)...`);

    let syncedCount = 0;
    for (const group of pendingGroups) {
      try {
        await this.apiSvc.saveCotizacion(group.value);
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
        text: `${syncedCount} cotización(es) offline guardada(s).`
      });
    }
  }
}
