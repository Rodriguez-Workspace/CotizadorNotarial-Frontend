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

  constructor(private apiSvc: ApiService) {
    this.initIndexedDB();
    window.addEventListener('online', () => this.syncOfflineData());
  }

  // ─── IndexedDB setup ───────────────────────────────────────────────────

  private initIndexedDB(): void {
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
      };

      request.onerror = (event: any) => {
        console.error('[OfflineService] IndexedDB error:', event.target.error);
      };
    } catch (e) {
      console.error('[OfflineService] Failed to open IndexedDB:', e);
    }
  }

  private saveToIndexedDB(items: CotizacionPayload[]): void {
    if (!this.db) return;
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add(items);
  }

  private clearIndexedDB(): void {
    if (!this.db) return;
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  }

  private getAllOfflineData(): Promise<{ key: IDBValidKey; value: CotizacionPayload[] }[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve([]);

      const tx    = this.db.transaction(STORE_NAME, 'readonly');
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
      this.saveToIndexedDB(items);
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 3500,
        icon: 'warning',
        title: '📴 Sin conexión',
        text: 'La cotización se guardará cuando recuperes internet.'
      });
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
      this.saveToIndexedDB(items);
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 4000,
        icon: 'warning', title: 'Error al guardar',
        text: 'Se guardó localmente. Se sincronizará cuando haya conexión.'
      });
    }
  }

  // ─── Sync ──────────────────────────────────────────────────────────────

  async syncOfflineData(): Promise<void> {
    const pendingGroups = await this.getAllOfflineData();
    if (pendingGroups.length === 0) return;

    console.log(`[OfflineService] Syncing ${pendingGroups.length} pending group(s)...`);

    let allSucceeded = true;
    for (const group of pendingGroups) {
      try {
        await this.apiSvc.saveCotizacion(group.value);
      } catch {
        allSucceeded = false;
        break;
      }
    }

    if (allSucceeded) {
      this.clearIndexedDB();
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
        icon: 'success',
        title: '🔄 Sincronizado',
        text: `${pendingGroups.length} cotización(es) offline guardada(s).`
      });
    }
  }
}
