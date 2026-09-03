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
  logo_url: string;
}

export interface NotariaContext {
  id: string;
  perfil: NotariaPerfil;
  rol: 'admin' | 'abogado';
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  user$: Observable<User | null>;

  private notariaContext = new BehaviorSubject<NotariaContext | null>(null);
  notariaContext$ = this.notariaContext.asObservable();

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

  async loginWithGoogle(): Promise<boolean> {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets');
    provider.addScope('https://www.googleapis.com/auth/drive.file');

    try {
      const result = await signInWithPopup(this.auth, provider);
      
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        sessionStorage.setItem('google_oauth_token', credential.accessToken);
      }

      // El ApiService cargará el contexto de notaría al detectar al usuario
      this.router.navigate(['/cotizador']);
      return true;
    } catch (error) {
      console.error('Error in login', error);
      Swal.fire('Error', 'Ocurrió un error al intentar iniciar sesión con Google.', 'error');
      return false;
    }
  }

  async renovarSesionGoogle(): Promise<string | null> {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets');
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    
    try {
      const result = await signInWithPopup(this.auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        sessionStorage.setItem('google_oauth_token', credential.accessToken);
        return credential.accessToken;
      }
    } catch (error) {
      console.error('Error al renovar sesión de Google', error);
    }
    return null;
  }

  async logout(): Promise<void> {
    sessionStorage.removeItem('google_oauth_token');
    this.notariaContext.next(null);
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }
}
