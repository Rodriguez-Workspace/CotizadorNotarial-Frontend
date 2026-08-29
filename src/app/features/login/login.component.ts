import { Component } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
})
export class LoginComponent {
  cargando = false;

  constructor(private auth: AuthService) {}

  async login() {
    this.cargando = true;
    const success = await this.auth.loginWithGoogle();
    
    // Si hubo un error o acceso denegado, desbloqueamos el botón.
    // Si fue exitoso (success = true), NO desbloqueamos el botón, 
    // lo dejamos en "Autenticando..." mientras el router cambia de página.
    if (!success) {
      this.cargando = false;
    }
  }
}
