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
    window.addEventListener('online', () => this.syncOfflineData());
  }

  private async getAuthHeaders(): Promise<HttpHeaders> {
    const currentUser = await firstValueFrom(user(this.auth).pipe(take(1)));
    if (!currentUser) throw new Error('No hay usuario autenticado');
    
    const token = await currentUser.getIdToken();
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
  }

  async saveCotizacion(data: CotizacionSheet): Promise<void> {
    if (!navigator.onLine) {
      await this.saveOffline(data);
      Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
        icon: 'info', title: 'Sin conexión', text: 'Respaldado localmente. Se sincronizará al reconectar.' });
      return;
    }

    try {
      const headers = await this.getAuthHeaders();
      await firstValueFrom(this.http.post(`${this.baseUrl}/api/cotizaciones`, data, { headers }));
      Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success', title: '¡Guardado en Google Sheets!' });
    } catch (error: any) {
      console.error('Error saving cotización:', error);
      await this.saveOffline(data);
      Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
        icon: 'warning', title: 'Error de red', text: 'Guardado localmente como respaldo.' });
    }
  }

  async saveCotizacionMulti(items: CotizacionItem[], refGlobal = '', notariaName = ''): Promise<void> {
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

  async getHistorial(limit = 100, offset = 0): Promise<{ data: CotizacionSheet[]; hasMore: boolean }> {
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
    } catch (error) {
      console.error('Error fetching historial:', error);
      return { data: await this.getOfflineData(), hasMore: false };
    }
  }

  // IndexedDB (fallback offline)
  private initIndexedDB() {
    try {
      const request = indexedDB.open('CotizadorDB', 1);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('cotizaciones_offline')) {
          db.createObjectStore('cotizaciones_offline', { autoIncrement: true });
        }
      };
      request.onerror = () => {
        console.warn('No se pudo inicializar IndexedDB (modo incógnito o sin permisos)', request.error);
      };
    } catch (e) {
      console.warn('Error sincrónico al abrir IndexedDB', e);
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
              reject(new Error('Store cotizaciones_offline no existe'));
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
        
        request.onerror = (event: any) => {
          reject(request.error || new Error('Error abriendo IndexedDB'));
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  private async syncOfflineData(): Promise<void> {
    try {
      const request = indexedDB.open('CotizadorDB', 1);
      request.onsuccess = (event: any) => {
        try {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('cotizaciones_offline')) return;
          
          const tx = db.transaction('cotizaciones_offline', 'readwrite');
          const store = tx.objectStore('cotizaciones_offline');
          const getAllReq = store.getAll();

          getAllReq.onsuccess = async () => {
            const records = getAllReq.result;
            if (records && records.length > 0) {
              let allSuccess = true;
              for (const record of records) {
                try {
                  const headers = await this.getAuthHeaders();
                  await firstValueFrom(this.http.post(`${this.baseUrl}/api/cotizaciones`, record, { headers }));
                } catch(e) {
                  console.error('Error sincronizando registro.', e);
                  allSuccess = false;
                }
              }
              if (allSuccess) {
                const deleteTx = db.transaction('cotizaciones_offline', 'readwrite');
                deleteTx.objectStore('cotizaciones_offline').clear();
              }
            }
          };
        } catch(e) {
          console.error('Error procesando sync', e);
        }
      };
    } catch(err) {
      console.error('Error abriendo DB para sync', err);
    }
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
            const store = tx.objectStore('cotizaciones_offline');
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => resolve(getAllReq.result || []);
            getAllReq.onerror = () => resolve([]);
          } catch(e) {
            resolve([]);
          }
        };
        request.onerror = () => resolve([]);
      } catch(err) {
        resolve([]);
      }
    });
  }
}
