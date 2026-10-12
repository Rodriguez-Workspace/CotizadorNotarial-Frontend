/**
 * auth.service.ts — VERSIÓN MIGRADA (Cloudflare)
 *
 * Simplificado respecto a la versión original:
 *  - Ya NO solicita scopes de Google Drive/Sheets (la SA del Worker los maneja)
 *  - Ya NO guarda el oauth token en sessionStorage
 *  - Ya NO llama directamente a Firestore (lo hace el Worker)
 *  - Sí obtiene el Firebase ID Token y lo expone para que ApiService lo use
 *
 * El flujo de autenticación:
 *  1. Login con Google (solo Firebase Auth, sin scopes extra)
 *  2. ApiService verifica el ID Token contra el Worker en cada petición
 *  3. El Worker carga el contexto de la notaría y lo devuelve en /api/tenant
 */

import { Injectable } from '@angular/core';
import { Auth, GoogleAuthProvider, signInWithPopup, signOut, user, User } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import Swal from 'sweetalert2';

export interface NotariaPerfil {
  nombre_oficial: string;
  ruc?: string;
  color_marca: string;
  color_membrete?: string;
  logo_url: string;
  direccion?: string;
  distrito_ciudad?: string;
  telefono_contacto?: string;
  membrete_izquierdo_url?: string;
  membrete_centro_url?: string;
  membrete_derecho_url?: string;
}

export type UserRole = 'superadmin' | 'titular' | 'admin' | 'abogado';

export interface NotariaContext {
  id: string;
  perfil: NotariaPerfil;
  rol: UserRole;
  spreadsheetId: string | null;
  serviceAccountEmail?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  user$: Observable<User | null>;

  private notariaContext = new BehaviorSubject<NotariaContext | null>(null);
  notariaContext$ = this.notariaContext.asObservable();

  private googleOAuthToken = new BehaviorSubject<string | null>(sessionStorage.getItem('google_oauth_token'));
  googleOAuthToken$ = this.googleOAuthToken.asObservable();

  constructor(private auth: Auth, private router: Router) {
    this.user$ = user(this.auth);
  }

  get currentContext(): NotariaContext | null {
    return this.notariaContext.value;
  }

  /** Expone el contexto para que lo establezca ApiService tras /api/tenant */
  setNotariaContext(ctx: NotariaContext | null): void {
    this.notariaContext.next(ctx);
  }

  setGoogleOAuthToken(token: string | null): void {
    if (token) {
      sessionStorage.setItem('google_oauth_token', token);
    } else {
      sessionStorage.removeItem('google_oauth_token');
    }
    this.googleOAuthToken.next(token);
  }

  getGoogleOAuthToken(): string | null {
    return this.googleOAuthToken.value || sessionStorage.getItem('google_oauth_token');
  }

  /**
   * Obtiene el Firebase ID Token del usuario actual.
   * El token expira cada hora; Firebase lo renueva automáticamente.
   */
  async getIdToken(): Promise<string | null> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) return null;
    try {
      return await currentUser.getIdToken();
    } catch {
      return null;
    }
  }

  /**
   * Solicita interactivamente permisos para Google Drive (drive.file)
   * y guarda el token OAuth para inicializar o vincular la hoja de cálculo.
   */
  async linkGoogleDrive(): Promise<string | null> {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets');
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    provider.setCustomParameters({ prompt: 'consent' });

    try {
      const result = await signInWithPopup(this.auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const oauthToken = credential?.accessToken || null;

      if (oauthToken) {
        this.setGoogleOAuthToken(oauthToken);
      }
      return oauthToken;
    } catch (error: any) {
      console.error('Error linking Google Drive', error);
      if (error?.code !== 'auth/popup-closed-by-user') {
        Swal.fire('Error', 'No se pudo autorizar Google Drive: ' + (error?.message || error), 'error');
      }
      return null;
    }
  }

  async loginWithGoogle(): Promise<boolean> {
    // Sin scopes adicionales — la Cuenta de Servicio de Google Cloud maneja Drive/Sheets desde el Backend
    const provider = new GoogleAuthProvider();

    try {
      await signInWithPopup(this.auth, provider);
      this.router.navigate(['/cotizador']);
      return true;
    } catch (error: any) {
      console.error('Error in login', error);
      if (error?.code !== 'auth/popup-closed-by-user') {
        Swal.fire('Error', 'Ocurrió un error al intentar iniciar sesión con Google.', 'error');
      }
      return false;
    }
  }

  async logout(): Promise<void> {
    this.setGoogleOAuthToken(null);
    this.notariaContext.next(null);
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }
}
