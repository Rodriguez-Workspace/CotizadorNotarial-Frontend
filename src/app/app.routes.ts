import { Routes } from '@angular/router';
import { AuthGuard, redirectLoggedInTo, redirectUnauthorizedTo } from '@angular/fire/auth-guard';

const redirectUnauthorizedToLogin = () => redirectUnauthorizedTo(['login']);
const redirectLoggedInToCotizador = () => redirectLoggedInTo(['cotizador']);

export const routes: Routes = [
  { 
    path: 'login', 
    loadComponent: () => import('./features/login/login.component').then(m => m.LoginComponent),
    canActivate: [AuthGuard],
    data: { authGuardPipe: redirectLoggedInToCotizador }
  },
  { 
    path: 'cotizador', 
    loadComponent: () => import('./features/cotizador/cotizador.component').then(m => m.CotizadorComponent),
    canActivate: [AuthGuard],
    data: { authGuardPipe: redirectUnauthorizedToLogin }
  },
  { 
    path: 'historial', 
    loadComponent: () => import('./features/historial/historial.component').then(m => m.HistorialComponent),
    canActivate: [AuthGuard],
    data: { authGuardPipe: redirectUnauthorizedToLogin }
  },
  { path: '', redirectTo: 'cotizador', pathMatch: 'full' },
  { path: '**', redirectTo: 'cotizador' }
];
