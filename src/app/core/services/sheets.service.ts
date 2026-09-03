import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import Swal from 'sweetalert2';
import { CotizacionItem } from './calculator.service';

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

@Injectable({
  providedIn: 'root'
})
export class SheetsService {
  private spreadsheetId: string | null = null;
  private readonly FILE_NAME = 'Cotizaciones Notariales';

  constructor(private http: HttpClient, private authSvc: AuthService) {
    this.initIndexedDB();
    window.addEventListener('online', () => this.syncOfflineData());
  }

  private getToken(): string | null {
    return sessionStorage.getItem('google_oauth_token');
  }

  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Authorization': `Bearer ${this.getToken()}`,
      'Content-Type': 'application/json'
    });
  }

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

  async saveCotizacion(data: CotizacionSheet) {
    const token = this.getToken();
    
    // Si no hay internet o no tenemos token guardado (sesión perdida/expirada localmente)
    if (!navigator.onLine || !token) {
      try {
        await this.saveOffline(data);
        if (!token) {
           Swal.fire('Guardado Local', 'Se respaldó localmente. Para enviarlo a tu Google Drive, por favor "Cierra Sesión" y vuelve a entrar para renovar los permisos de Google.', 'info');
        } else {
           Swal.fire({
             toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
             icon: 'info', title: 'Respaldado localmente', text: 'Se sincronizará cuando vuelva el internet.'
           });
        }
      } catch (e) {
        console.error('Error guardando offline', e);
        Swal.fire('Error', 'No pudimos guardar la cotización. Revisa si estás en modo incógnito (navegación privada) o si tu navegador bloquea el almacenamiento local.', 'error');
      }
      return;
    }

    try {
      if (!this.spreadsheetId) {
        await this.initializeSpreadsheet();
      }

      await this.appendRow(data);
      Swal.fire({
        toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
        icon: 'success', title: '¡Guardado exitosamente en Google Sheets!'
      });
      
    } catch (error: any) {
      console.error('Error en Sheets API', error);
      
      if (error.status === 401) {
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
                if (!this.spreadsheetId) await this.initializeSpreadsheet();
                await this.appendRow(data);
                Swal.fire({
                  toast: true, position: 'top-end', showConfirmButton: false, timer: 2500,
                  icon: 'success', title: 'Sesión renovada y guardado exitosamente'
                });
                return; // Exito
              } catch (retryError) {
                console.error('Fallo tras renovar', retryError);
              }
            } else {
               Swal.fire('Error', 'Tu navegador bloqueó la ventana de Google o cancelaste el inicio de sesión. Por favor, intenta de nuevo y permite las ventanas emergentes si te lo solicita.', 'warning');
            }
         }
      }
      
      try {
        await this.saveOffline(data);
        Swal.fire('Guardado Local', 'Se ha respaldado localmente y se intentará subir luego.', 'info');
      } catch (e) {
        console.error('Error fallback offline', e);
        Swal.fire('Error Grave', 'No pudimos guardar en la nube ni localmente. Verifica tu conexión o si estás usando modo incógnito.', 'error');
      }
    }
  }

  async saveCotizacionMulti(items: CotizacionItem[], refGlobal: string = '') {
    if (!items || items.length === 0) return;

    const fechaStr = new Date().toISOString();
    const referenciaInterna = refGlobal || '';
    const tipoActo = items.map(it => it.acto.nombre).join(' + ');
    const moneda = items[0].moneda;

    const cantidadInmuebles = items.reduce((sum, it) => sum + it.cantidadInmuebles, 0);
    const costoNotarial = items.reduce((sum, it) => sum + it.costoNotarialFinal, 0);
    const costoRegistral = items.reduce((sum, it) => sum + it.costoRegistralFinal, 0);
    const totalPagar = items.reduce((sum, it) => sum + it.totalFinal, 0);

    const sheetData: CotizacionSheet = {
      fecha: fechaStr,
      referenciaInterna,
      tipoActo,
      moneda,
      cantidadInmuebles,
      costoNotarial,
      costoRegistral,
      totalPagar
    };

    return this.saveCotizacion(sheetData);
  }

  private async initializeSpreadsheet() {
    // 1. Buscar si el archivo ya existe en Drive
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${this.FILE_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const searchRes: any = await firstValueFrom(this.http.get(searchUrl, { headers: this.getHeaders() }));
    
    if (searchRes.files && searchRes.files.length > 0) {
      this.spreadsheetId = searchRes.files[0].id;
      return; // El archivo ya existe
    }

    // 2. Si no existe, crearlo
    const createUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
    const body = {
      properties: { title: this.FILE_NAME }
    };
    const createRes: any = await firstValueFrom(this.http.post(createUrl, body, { headers: this.getHeaders() }));
    this.spreadsheetId = createRes.spreadsheetId;

    // 3. Insertar las cabeceras solicitadas en la fila 1
    await this.appendRowValues([
      'Fecha', 'Referencia Interna', 'Tipo de Acto', 'Moneda', 
      'Cantidad Inmuebles', 'Costo Notarial', 'Costo Registral', 'Total a Pagar', 'Notaría'
    ]);
  }

  private async appendRow(data: CotizacionSheet) {
    const notariaName = this.authSvc.currentContext?.perfil?.nombre_oficial || 'Desconocida';
    
    const row = [
      data.fecha,
      data.referenciaInterna,
      data.tipoActo,
      data.moneda,
      data.cantidadInmuebles.toString(),
      data.costoNotarial.toString(),
      data.costoRegistral.toString(),
      data.totalPagar.toString(),
      notariaName
    ];
    await this.appendRowValues(row);
  }

  private async appendRowValues(values: any[]) {
    if (!this.spreadsheetId) throw new Error('No spreadsheet ID guardado en memoria');
    
    const range = 'A1';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
    
    const body = {
      values: [values]
    };
    
    await firstValueFrom(this.http.post(url, body, { headers: this.getHeaders() }));
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

  private async syncOfflineData() {
    const token = this.getToken();
    if (!token) return;

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
              try {
                 if (!this.spreadsheetId) await this.initializeSpreadsheet();
                 
                 for (const record of records) {
                   await this.appendRow(record);
                 }
                 
                 // Limpiar IndexedDB si todo fue exitoso
                 const deleteTx = db.transaction('cotizaciones_offline', 'readwrite');
                 deleteTx.objectStore('cotizaciones_offline').clear();
              } catch(e) {
                 console.error('Error sincronizando en background. Se intentará luego.', e);
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

  async getHistorial(limit: number = 100, offset: number = 0): Promise<{data: CotizacionSheet[], hasMore: boolean}> {
    const token = this.getToken();
    if (!navigator.onLine || !token) {
      const offlineData = await this.getOfflineData();
      return { data: offlineData, hasMore: false };
    }

    try {
      if (!this.spreadsheetId) {
        const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${this.FILE_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
        const searchRes: any = await firstValueFrom(this.http.get(searchUrl, { headers: this.getHeaders() }));
        if (searchRes.files && searchRes.files.length > 0) {
          this.spreadsheetId = searchRes.files[0].id;
        } else {
          return { data: await this.getOfflineData(), hasMore: false }; 
        }
      }

      // 1. Obtener conteo de filas leyendo solo la columna A
      const countUrl = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/A:A`;
      const countRes: any = await firstValueFrom(this.http.get(countUrl, { headers: this.getHeaders() }));
      const totalRows = (countRes.values || []).length;
      
      if (totalRows <= 1) return { data: [], hasMore: false }; // Solo hay cabecera o está vacía

      // 2. Calcular rango de descarga (desde el final hacia arriba)
      let endRow = totalRows - offset;
      if (endRow < 2) return { data: [], hasMore: false };
      
      let startRow = endRow - limit + 1;
      if (startRow < 2) startRow = 2;
      
      const hasMore = startRow > 2; // Si no llegamos a la fila 2, hay más antiguos
      
      const range = `A${startRow}:I${endRow}`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}`;
      const res: any = await firstValueFrom(this.http.get(url, { headers: this.getHeaders() }));
      
      const rows = res.values || [];
      const parsedRows: CotizacionSheet[] = rows.map((row: any[]) => ({
        fecha: row[0] || '',
        referenciaInterna: row[1] || '',
        tipoActo: row[2] || '',
        moneda: row[3] || '',
        cantidadInmuebles: parseInt(row[4]) || 0,
        costoNotarial: parseFloat(row[5]) || 0,
        costoRegistral: parseFloat(row[6]) || 0,
        totalPagar: parseFloat(row[7]) || 0,
        notaria: row[8] || ''
      }));

      return { data: parsedRows, hasMore };

    } catch(e: any) {
      console.error('Error obteniendo historial de Sheets', e);
      
      if (e.status === 401) {
         const result = await Swal.fire({
           title: 'Sesión Expirada',
           text: 'Tu sesión de Google ha expirado. ¿Deseas reconectar ahora para ver el historial en vivo de la nube?',
           icon: 'warning',
           showCancelButton: true,
           confirmButtonText: 'Sí, reconectar',
           cancelButtonText: 'Ver offline',
           confirmButtonColor: '#125B18'
         });
         
         if (result.isConfirmed) {
            const nuevoToken = await this.authSvc.renovarSesionGoogle();
            if (nuevoToken) {
               return this.getHistorial(limit, offset);
            }
         }
      }
      
      return { data: await this.getOfflineData(), hasMore: false };
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
