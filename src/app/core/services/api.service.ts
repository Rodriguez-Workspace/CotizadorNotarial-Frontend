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

  getSpreadsheetId(): string | null {
    return this._tenant?.spreadsheetId || null;
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
    const res = await this.post<{ success: boolean; spreadsheetId?: string }>('/api/cotizacion', { items });
    if (res?.spreadsheetId && this._tenant && !this._tenant.spreadsheetId) {
      this._tenant = {
        ...this._tenant,
        spreadsheetId: res.spreadsheetId
      };
      this.authSvc.setNotariaContext({ ...this._tenant });
    }
  }

  // ─── Historial ───────────────────────────────────────────────────────────

  async getHistorial(limit = 100, offset = 0): Promise<HistorialResult> {
    const oauthToken = this.authSvc.getGoogleOAuthToken();
    const sheetId = this._tenant?.spreadsheetId;

    if (oauthToken && sheetId) {
      try {
        const googleHeaders = new HttpHeaders({
          'Authorization': `Bearer ${oauthToken}`,
          'Content-Type': 'application/json'
        });

        // 1. Obtener conteo de filas leyendo columna A
        const countUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:A`;
        const countRes: any = await firstValueFrom(
          this.http.get(countUrl, { headers: googleHeaders })
        );
        const totalRows = (countRes.values || []).length;

        if (totalRows <= 1) return { data: [], hasMore: false };

        // 2. Calcular rango de descarga (desde el final hacia arriba)
        let endRow = totalRows - offset;
        if (endRow < 2) return { data: [], hasMore: false };

        let startRow = endRow - limit + 1;
        if (startRow < 2) startRow = 2;

        const hasMore = startRow > 2;
        const range = `A${startRow}:I${endRow}`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
        const res: any = await firstValueFrom(
          this.http.get(url, { headers: googleHeaders })
        );

        const rows: any[][] = res.values || [];
        const parsed: CotizacionPayload[] = rows.map((r) => ({
          fecha:             String(r[0] || ''),
          referenciaInterna: String(r[1] || ''),
          tipoActo:          String(r[2] || ''),
          moneda:            String(r[3] || 'SOLES'),
          cantidadBienes:    parseInt(r[4]) || 1,
          costoNotarial:     parseFloat(r[5]) || 0,
          costoRegistral:    parseFloat(r[6]) || 0,
          totalPagar:        parseFloat(r[7]) || 0,
        }));

        return { data: parsed.reverse(), hasMore };
      } catch (err: any) {
        console.warn('[ApiService] Fallo lectura directa de Sheets, usando backend:', err);
      }
    }

    return this.get<HistorialResult>(`/api/historial?limit=${limit}&offset=${offset}`);
  }

  // ─── Cache invalidation ──────────────────────────────────────────────────

  clearCache(): void {
    this._tarifario = null;
    this._variables = null;
  }
}
