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
        } else if (!this.router.url.includes('/login')) {
          setTimeout(() => {
            if (this._tenant && !this._tenant.spreadsheetId) {
              this.createGoogleSheetInteractive();
            }
          }, 1000);
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
      return false;
    }
  }

  // ─── Spreadsheet Management ───────────────────────────────────────────────

  extractSpreadsheetId(input: string): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,80})/);
    if (match) return match[1];
    if (/^[a-zA-Z0-9_-]{20,80}$/.test(trimmed)) return trimmed;
    return null;
  }

  async saveSpreadsheetId(input: string): Promise<boolean> {
    const spreadsheetId = this.extractSpreadsheetId(input);
    if (!spreadsheetId) {
      Swal.fire('Error', 'El formato del ID o enlace de Google Sheets no es válido.', 'error');
      return false;
    }

    try {
      await this.post('/api/tenant/spreadsheet', { spreadsheetId });
      if (this._tenant) {
        this._tenant = {
          ...this._tenant,
          spreadsheetId
        };
        this.authSvc.setNotariaContext({ ...this._tenant });
      }
      return true;
    } catch (err: any) {
      console.error('Error guardando spreadsheetId:', err);
      Swal.fire('Error', 'No se pudo guardar la hoja de cálculo: ' + (err?.message || err), 'error');
      return false;
    }
  }

  private isCreatingSheet = false;

  /**
   * Intenta crear automáticamente la hoja en Google Drive del abogado.
   * Si por alguna razón la API de Google da error o el usuario cancela,
   * abre automáticamente el asistente para vincular pegando el enlace.
   */
  async createGoogleSheetInteractive(): Promise<boolean> {
    if (this.isCreatingSheet) return false;
    this.isCreatingSheet = true;
    try {
      if (!this._tenant) {
        await this.loadTenant();
      }
      const ctx = this._tenant;
      if (!ctx) return false;

      // 1. Solicitar token con Google Drive + Sheets
      const token = await this.authSvc.linkGoogleDrive();
      if (!token) {
        // Si canceló la ventana de Google, ofrecer vincular por enlace
        return await this.promptLinkSpreadsheet();
      }

      // 2. Intentar crear la hoja en su Drive
      const success = await this.initializeGoogleSheet(ctx, token);
      if (success) {
        Swal.fire({
          icon: 'success',
          title: '¡Hoja creada con éxito!',
          text: 'Se ha creado la hoja en tu Google Drive y ya está vinculada al cotizador.',
          confirmButtonColor: '#1e40af'
        });
        return true;
      }

      // 3. Si falló la creación automática de Google, abrir el asistente de enlace
      return await this.promptLinkSpreadsheet();
    } finally {
      this.isCreatingSheet = false;
    }
  }

  /**
   * Abre un modal con instrucciones claras para vincular la hoja de Google Sheets
   * pegando su enlace y compartiéndola con la Service Account.
   */
  async promptLinkSpreadsheet(): Promise<boolean> {
    if (!this._tenant) {
      await this.loadTenant();
    }
    const ctx = this._tenant;
    const saEmail = ctx?.serviceAccountEmail || 'cuenta de servicio';

    const { value: urlOrId } = await Swal.fire({
      title: 'Vincular Google Sheets',
      html: `
        <div style="text-align: left; font-size: 13px; color: #374151; line-height: 1.5;">
          <p style="margin-bottom: 8px;">Para que el cotizador guarde tus cotizaciones en tu Google Sheet:</p>
          <ol style="margin-left: 20px; list-style-type: decimal; margin-bottom: 12px; font-size: 12px;">
            <li style="margin-bottom: 4px;">Crea una hoja en blanco en <a href="https://sheets.new" target="_blank" style="color: #2563eb; text-decoration: underline; font-weight: 600;">sheets.new</a></li>
            <li style="margin-bottom: 4px;">Haz clic en <strong>Compartir</strong> (botón verde) y añade como <strong>Editor</strong> este correo:</li>
          </ol>
          <div style="background: #f3f4f6; border: 1px solid #e5e7eb; padding: 8px 10px; border-radius: 6px; font-family: monospace; font-size: 11px; word-break: break-all; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span id="swal-sa-email" style="user-select: all; font-weight: 600; color: #1e40af;">${saEmail}</span>
            <button type="button" id="copy-sa-btn" style="background: #e0e7ff; color: #3730a3; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; border: none; flex-shrink: 0;">
              Copiar
            </button>
          </div>
          <p style="margin-bottom: 4px; font-size: 12px;">3. Pega aquí el enlace de tu hoja o su ID:</p>
        </div>
      `,
      input: 'text',
      inputValue: '',
      inputPlaceholder: 'https://docs.google.com/spreadsheets/d/.../edit',
      showCancelButton: true,
      confirmButtonText: 'Vincular Hoja',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#1e40af',
      cancelButtonColor: '#6b7280',
      didOpen: () => {
        const btn = document.getElementById('copy-sa-btn');
        if (btn) {
          btn.onclick = () => {
            navigator.clipboard.writeText(saEmail);
            btn.innerText = '¡Copiado!';
            setTimeout(() => { btn.innerText = 'Copiar'; }, 2000);
          };
        }
      },
      preConfirm: (val) => {
        if (!val || !val.trim()) {
          Swal.showValidationMessage('Ingresa el enlace o ID de tu hoja de Google Sheets');
          return false;
        }
        const id = this.extractSpreadsheetId(val);
        if (!id) {
          Swal.showValidationMessage('El enlace o ID no es válido (debe ser una URL de Google Sheets o un ID)');
          return false;
        }
        return id;
      }
    });

    if (urlOrId) {
      const ok = await this.saveSpreadsheetId(urlOrId);
      if (ok) {
        Swal.fire({
          icon: 'success',
          title: '¡Hoja vinculada con éxito!',
          text: 'Tus cotizaciones ahora se registrarán automáticamente en tu Google Sheet.',
          confirmButtonColor: '#1e40af'
        });
        return true;
      }
    }
    return false;
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
    if (!this._tenant?.spreadsheetId) {
      const ok = await this.createGoogleSheetInteractive();
      if (!ok) {
        throw new Error('No se vinculó una hoja de Google Sheets para registrar la cotización.');
      }
    }
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
