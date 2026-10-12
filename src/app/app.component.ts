import { Component, Renderer2, OnInit, Inject } from '@angular/core';
import { RouterOutlet, RouterModule, Router } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { ApiService } from './core/services/api.service';
import { AsyncPipe, DOCUMENT } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import Swal from 'sweetalert2';

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

      @if(auth.notariaContext$ | async; as ctx) {
        @if(!ctx.spreadsheetId) {
          <div class="bg-amber-600 text-white px-4 py-2.5 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-3 shadow-md z-40 relative">
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5 flex-shrink-0 text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <span><strong>Atención:</strong> Tu usuario aún no tiene vinculada su hoja de Google Sheets para registrar cotizaciones.</span>
            </div>
            <button
              type="button"
              (click)="linkGoogleSheet()"
              [disabled]="isLinkingSheet"
              class="bg-white text-amber-900 hover:bg-amber-100 font-semibold px-3 py-1.5 rounded-lg shadow-sm transition text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              @if(isLinkingSheet) {
                <span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-amber-900 border-t-transparent rounded-full"></span>
                <span>Conectando...</span>
              } @else {
                <svg class="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
                <span>Conectar con Google Drive</span>
              }
            </button>
          </div>
        }
      }
    }
    <main>
      <router-outlet></router-outlet>
    </main>
  `,
})
export class AppComponent implements OnInit {
  isLinkingSheet = false;

  constructor(
    public auth: AuthService,
    public router: Router,
    public apiSvc: ApiService,
    private renderer: Renderer2,
    private titleService: Title,
    @Inject(DOCUMENT) private document: Document,
    private swUpdate: SwUpdate
  ) {
    // Escuchar actualizaciones del Service Worker para evitar el caché duro
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          Swal.fire({
            title: 'Actualización disponible',
            text: 'Se ha detectado una nueva versión del cotizador con mejoras. Se requiere actualizar para aplicar los cambios.',
            icon: 'info',
            showCancelButton: false,
            allowOutsideClick: false,
            allowEscapeKey: false,
            confirmButtonColor: '#3085d6',
            confirmButtonText: 'Actualizar ahora'
          }).then((result) => {
            if (result.isConfirmed) {
              this.document.location.reload();
            }
          });
        });
    }
  }

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

        // 4. Inyección Dinámica del PWA Manifest
        if (ctx.perfil.nombre_oficial && ctx.perfil.logo_url) {
          const manifest = {
            name: ctx.perfil.nombre_oficial,
            short_name: ctx.perfil.nombre_oficial,
            theme_color: '#2B2B2B',
            background_color: '#fafafa',
            display: 'standalone',
            scope: './',
            start_url: './',
            description: `Sistema de cotización para ${ctx.perfil.nombre_oficial}`,
            icons: [
              {
                src: ctx.perfil.logo_url,
                sizes: "192x192 512x512",
                type: "image/png",
                purpose: "any"
              }
            ]
          };
          const stringManifest = JSON.stringify(manifest);
          const blob = new Blob([stringManifest], { type: 'application/json' });
          const manifestURL = URL.createObjectURL(blob);
          let manifestLink = this.document.querySelector("link[rel='manifest']") as HTMLLinkElement;
          if (manifestLink?.href && manifestLink.href.startsWith('blob:')) {
            URL.revokeObjectURL(manifestLink.href);
          }
          if (!manifestLink) {
            manifestLink = this.document.createElement('link');
            manifestLink.rel = 'manifest';
            this.document.head.appendChild(manifestLink);
          }
          manifestLink.href = manifestURL;
        }
      } else {
        this.titleService.setTitle('Cotizador Notarial');
      }
    });
  }


  async linkGoogleSheet() {
    this.isLinkingSheet = true;
    try {
      await this.apiSvc.linkGoogleDriveAndCreateSheet();
    } finally {
      this.isLinkingSheet = false;
    }
  }

  logout() {
    this.auth.logout();
  }
}
