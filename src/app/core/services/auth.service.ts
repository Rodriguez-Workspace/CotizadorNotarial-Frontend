import { Injectable, inject } from '@angular/core';
import { Auth, GoogleAuthProvider, signInWithPopup, signOut, user, User } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
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
  
  // Estado global de la notaría
  private notariaContext = new BehaviorSubject<NotariaContext | null>(null);
  notariaContext$ = this.notariaContext.asObservable();

  constructor(private auth: Auth, private firestore: Firestore, private router: Router) {
    this.user$ = user(this.auth);
    
    // Restaurar estado al recargar si hay usuario
    this.user$.subscribe(async (user) => {
      if (user && user.email) {
        await this.loadNotariaContext(user.email);
      } else {
        this.notariaContext.next(null);
      }
    });
  }

  get currentContext(): NotariaContext | null {
    return this.notariaContext.value;
  }

  private async loadNotariaContext(email: string): Promise<boolean> {
    try {
      // 1. Obtener usuario
      const ref = doc(this.firestore, 'usuarios_autorizados', email);
      const docSnap = await getDoc(ref);
      
      if (!docSnap.exists()) return false;
      const userData = docSnap.data();
      
      if (userData['estado'] !== 'activo') return false;

      const notariaId = userData['notaria_id'];
      const rol = userData['rol'];

      // 2. Obtener perfil de la notaría
      const notariaRef = doc(this.firestore, 'notarias', notariaId);
      const notariaSnap = await getDoc(notariaRef);
      
      let perfil: NotariaPerfil = { nombre_oficial: 'Notaría', color_marca: '#125B18', logo_url: '' };
      
      if (notariaSnap.exists() && notariaSnap.data()['perfil']) {
        perfil = notariaSnap.data()['perfil'];
      }

      this.notariaContext.next({ id: notariaId, perfil, rol });
      return true;

    } catch(e) {
      console.error(e);
      return false;
    }
  }

  async loginWithGoogle(): Promise<boolean> {
    const provider = new GoogleAuthProvider();
    
    try {
      const result = await signInWithPopup(this.auth, provider);
      const email = result.user.email;
      
      if (!email) throw new Error('No email found');

      const isAuthorized = await this.loadNotariaContext(email);
      
      if (!isAuthorized) {
        await this.logout();
        Swal.fire('Acceso Denegado', 'Tu usuario no está autorizado o está inactivo en el sistema.', 'error');
        return false;
      }
      
      this.router.navigate(['/cotizador']);
      return true;
      
    } catch (error) {
      console.error('Error in login', error);
      Swal.fire('Error', 'Ocurrió un error al intentar iniciar sesión con Google.', 'error');
      return false;
    }
  }

  async logout() {
    this.notariaContext.next(null);
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }
}

