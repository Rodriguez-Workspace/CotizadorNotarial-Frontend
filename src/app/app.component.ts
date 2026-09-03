import { Component, Renderer2, OnInit, Inject } from '@angular/core';
import { RouterOutlet, RouterModule, Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { AsyncPipe, DOCUMENT } from '@angular/common';
import { Title } from '@angular/platform-browser';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterModule, AsyncPipe],
  template: `
    @if((auth.user$ | async) && router.url !== '/login') {
      <nav class="bg-dark text-white p-4 shadow-md flex justify-between items-center px-4 md:px-8 sticky top-0 z-50">
        <div class="font-bold text-xl text-secondary flex items-center gap-2">
          @if(auth.notariaContext$ | async; as ctx) {
            @if(ctx.perfil.logo_url) {
              <img [src]="ctx.perfil.logo_url" alt="Logo" class="h-8 w-auto">
            } @else {
              <div class="h-8 w-8 bg-primary rounded-full flex items-center justify-center font-bold text-white">N</div>
            }
            {{ ctx.perfil.nombre_oficial }}
          } @else {
            <div class="h-8 w-8 bg-gray-600 animate-pulse rounded-full"></div>
            <div class="h-6 w-32 bg-gray-600 animate-pulse rounded"></div>
          }
        </div>
        <div class="flex items-center gap-4 md:gap-6 font-medium text-sm md:text-base">
          <a routerLink="/cotizador" routerLinkActive="text-primary border-b-2 border-primary" class="hover:text-secondary transition-colors py-1">Cotizador</a>
          <a routerLink="/historial" routerLinkActive="text-primary border-b-2 border-primary" class="hover:text-secondary transition-colors py-1">Historial</a>
          
          <div class="h-6 w-px bg-gray-500 hidden md:block"></div>

          <button (click)="logout()" title="Cerrar Sesión" class="text-gray-300 hover:text-white hover:bg-gray-700 p-2 rounded-md transition-colors flex items-center gap-1">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            <span class="hidden md:inline text-sm">Salir</span>
          </button>
        </div>
      </nav>
    }
    <main>
      <router-outlet></router-outlet>
    </main>
  `,
})
export class AppComponent implements OnInit {
  constructor(
    public auth: AuthService, 
    public router: Router,
    private renderer: Renderer2,
    private titleService: Title,
    @Inject(DOCUMENT) private document: Document
  ) {}

  ngOnInit() {
    this.auth.notariaContext$.subscribe(ctx => {
      if (ctx && ctx.perfil) {
        if (ctx.perfil.color_marca) {
          this.document.body.style.setProperty('--color-marca', ctx.perfil.color_marca);
        }
        if (ctx.perfil.nombre_oficial) {
          this.titleService.setTitle(`Cotizador - ${ctx.perfil.nombre_oficial}`);
        }
        if (ctx.perfil.logo_url) {
          let link: HTMLLinkElement = this.document.querySelector("link[rel*='icon']") as HTMLLinkElement;
          if (!link) {
            link = this.document.createElement('link');
            link.type = 'image/x-icon';
            link.rel = 'shortcut icon';
            this.document.head.appendChild(link);
          }
          link.href = ctx.perfil.logo_url;
        }
      } else {
         this.titleService.setTitle('Cotizador Notarial');
      }
    });
  }

  logout() {
    this.auth.logout();
  }
}
