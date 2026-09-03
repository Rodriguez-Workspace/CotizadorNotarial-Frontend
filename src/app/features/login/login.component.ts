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
    if (!success) {
      this.cargando = false;
    }
  }
}
