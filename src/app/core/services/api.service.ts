/**
 * api.service.ts
 *
 * Único servicio que se comunica con el Cloudflare Worker (backend).
 * Reemplaza a: DataService, ExchangeRateService, CacheService y SheetsService
 * (parte online de Sheets — la parte offline sigue en OfflineService).
 *
 * Cada petición incluye el Firebase ID Token en el header Authorization.
 * Si el Worker devuelve 401/403, hace logout automático.
 *
 * Caché en memoria (por sesión):
 *  - tenant: se cachea hasta que el usuario cierra sesión
 *  - tarifario: se cachea por sesión (se invalida con forzarActualizacion())
 *  - variables (UIT+TC): se cachea por sesión
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { environment } from '../../../environments/environment';
import { AuthService, NotariaContext, UserRole } from './auth.service';
import { TarifarioActo } from './calculator.service';
import Swal from 'sweetalert2';

export interface VariablesGlobales {
  UIT: number;
  compra: number;
  venta: number;
  moneda: string;
  origen: string;
  fecha_sunat: string;
}

export interface CotizacionPayload {
  fecha: string;
  referenciaInterna: string;
  tipoActo: string;
  moneda: string;
  cantidadBienes: number;
  costoNotarial: number;
  costoRegistral: number;
  totalPagar: number;
}

export interface HistorialResult {
  data: CotizacionPayload[];
  hasMore: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly base = environment.apiUrl;

  // In-memory cache (cleared on page reload)
  private _tenant: NotariaContext | null = null;
  private _tarifario: TarifarioActo[] | null = null;
  private _variables: VariablesGlobales | null = null;

  constructor(
    private http: HttpClient,
    private auth: Auth,
    private authSvc: AuthService,
    private router: Router
  ) {
    // Load tenant context whenever a user signs in
    user(this.auth).subscribe(async (firebaseUser) => {
      if (firebaseUser) {
        await this.loadTenant();
      } else {
        this._tenant = null;
        this._tarifario = null;
        this._variables = null;
        this.authSvc.setNotariaContext(null);
      }
    });

    // Escuchar la llegada del token OAuth (ej. recién logueado o vinculado interactivamente)
    this.authSvc.googleOAuthToken$.subscribe(async (token) => {
      if (token && this._tenant && !this._tenant.spreadsheetId) {
        await this.initializeGoogleSheet(this._tenant, token);
      }
    });
  }

  // ─── Auth headers ────────────────────────────────────────────────────────

  private async headers(): Promise<HttpHeaders> {
    const token = await this.authSvc.getIdToken();
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });
  }

  private async get<T>(path: string): Promise<T> {
    const headers = await this.headers();
    try {
      return await firstValueFrom(
        this.http.get<T>(`${this.base}${path}`, { headers })
      );
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        await this.authSvc.logout();
      }
      throw err;
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const headers = await this.headers();
    try {
      return await firstValueFrom(
        this.http.post<T>(`${this.base}${path}`, body, { headers })
      );
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        await this.authSvc.logout();
      }
      throw err;
    }
  }

  // ─── Tenant ──────────────────────────────────────────────────────────────

  async loadTenant(): Promise<NotariaContext | null> {
    try {
      const res = await this.get<{ notariaId: string; rol: string; perfil: any; spreadsheetId: string | null; serviceAccountEmail: string }>('/api/tenant');
      const ctx: NotariaContext = {
        id: res.notariaId,
        rol: res.rol as UserRole,
        perfil: res.perfil,
        spreadsheetId: res.spreadsheetId,
        serviceAccountEmail: res.serviceAccountEmail
      };
      this._tenant = ctx;
      this.authSvc.setNotariaContext(ctx);
      
      // Híbrido: Si no tiene hoja de cálculo y tenemos token en memoria/sessionStorage, inicializarla
      if (!ctx.spreadsheetId) {
        const token = this.authSvc.getGoogleOAuthToken();
        if (token) {
          await this.initializeGoogleSheet(ctx, token);
        }
      }
      
      return ctx;
    } catch (err: any) {
      if (err.status === 403) {
        await this.authSvc.logout();
        Swal.fire('Acceso Denegado', 'Tu usuario no está autorizado o está inactivo en el sistema.', 'error');
      }
      return null;
    }
  }

  // ─── Spreadsheet Initialization (Hybrid) ───────────────────────────────────

  async initializeGoogleSheet(ctx: NotariaContext, explicitToken?: string): Promise<boolean> {
    const oauthToken = explicitToken || this.authSvc.getGoogleOAuthToken();
    if (!oauthToken) {
      console.warn('No hay token OAuth para crear el Excel.');
      return false;
    }

    try {
      // 1. Crear el Spreadsheet
      const title = `Cotizaciones — ${ctx.perfil.nombre_oficial}`;
      const body = {
        properties: { title },
        sheets: [
          {
            properties: { title: 'Cotizaciones', sheetId: 0 },
            data: [{
              startRow: 0, startColumn: 0,
              rowData: [{
                values: ['Fecha', 'Referencia Interna', 'Tipo de Acto', 'Moneda', 'Cantidad Bienes', 'Costo Notarial', 'Costo Registral', 'Total a Pagar'].map(v => ({ userEnteredValue: { stringValue: v } }))
              }]
            }]
          }
        ]
      };

      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const createData = await createRes.json();
      const spreadsheetId = createData.spreadsheetId;
      if (!spreadsheetId) {
        console.error('Error creating spreadsheet:', createData);
        throw new Error(createData?.error?.message || 'No se pudo crear la hoja en Google Sheets');
      }

      // 2. Compartir con el Service Account del Backend
      const serviceAccountEmail = ctx.serviceAccountEmail;
      if (serviceAccountEmail) {
        try {
          const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: serviceAccountEmail })
          });
          if (!permRes.ok) {
            console.warn('Could not share sheet with service account:', await permRes.text());
          }
        } catch (shareErr) {
          console.warn('Failed sharing sheet with service account:', shareErr);
        }
      }

      // 3. Guardar el ID en Backend (Firestore)
      await this.post('/api/tenant/spreadsheet', { spreadsheetId });
      
      // Actualizar el contexto en memoria
      this._tenant = {
        ...this._tenant!,
        spreadsheetId
      };
      this.authSvc.setNotariaContext({ ...this._tenant });
      
      console.log('Google Sheet initialized and shared successfully:', spreadsheetId);
      return true;
    } catch (e: any) {
      console.error('Failed to initialize Google Sheet', e);
      Swal.fire('Atención', 'No se pudo crear la hoja de cálculo automática: ' + (e?.message || e), 'warning');
      return false;
    }
  }

  /**
   * Permite al usuario autorizar interactivamente Google Drive si no se creó
   * la hoja al iniciar sesión.
   */
  async linkGoogleDriveAndCreateSheet(): Promise<boolean> {
    if (!this._tenant) {
      await this.loadTenant();
    }
    if (!this._tenant) return false;
    if (this._tenant.spreadsheetId) return true;

    const token = await this.authSvc.linkGoogleDrive();
    if (!token) return false;

    const success = await this.initializeGoogleSheet(this._tenant, token);
    if (success) {
      Swal.fire({
        icon: 'success',
        title: '¡Hoja de cálculo vinculada!',
        text: 'Tu hoja de Google Sheets se ha creado en tu Google Drive y está conectada al cotizador.',
        confirmButtonColor: '#1e40af'
      });
    }
    return success;
  }

  // ─── Tarifario ───────────────────────────────────────────────────────────

  async getTarifarioActos(): Promise<TarifarioActo[]> {
    if (this._tarifario) return this._tarifario;
    const res = await this.get<{ actos: TarifarioActo[] }>('/api/tarifario');
    this._tarifario = res.actos;
    return this._tarifario;
  }

  // ─── Variables (UIT + TC) ────────────────────────────────────────────────

  async getVariables(): Promise<VariablesGlobales> {
    if (this._variables) return this._variables;
    const res = await this.get<VariablesGlobales>('/api/variables');
    this._variables = res;
    return this._variables;
  }

  // ─── Cotizacion ──────────────────────────────────────────────────────────

  async saveCotizacion(items: CotizacionPayload[]): Promise<void> {
    await this.post('/api/cotizacion', { items });
  }

  // ─── Historial ───────────────────────────────────────────────────────────

  async getHistorial(limit = 100, offset = 0): Promise<HistorialResult> {
    return this.get<HistorialResult>(`/api/historial?limit=${limit}&offset=${offset}`);
  }

  // ─── Cache invalidation ──────────────────────────────────────────────────

  clearCache(): void {
    this._tarifario = null;
    this._variables = null;
  }
}
