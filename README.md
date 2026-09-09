# Cotizador Notarial — Frontend (Angular SPA)

Aplicación web progresiva (PWA) para generar cotizaciones de escrituras públicas notariales. Construida con [Angular 18](https://angular.dev/) y [TailwindCSS](https://tailwindcss.com/), desplegada en [Cloudflare Pages](https://pages.cloudflare.com/).

## Requisitos Previos

- **Node.js** ≥ 18
- **npm** ≥ 9
- Angular CLI (`npx ng` o `npm install -g @angular/cli`)

## Instalación

```bash
cd CotizadorNotarial-Frontend
npm install
```

## Desarrollo Local

```bash
npm start        # equivalente a ng serve
```

El servidor de desarrollo se inicia en `http://localhost:4200`.

> **Nota:** El frontend se conecta al Worker backend en producción por defecto. Para desarrollo local del backend, modifica `src/environments/environment.ts`:
>
> ```typescript
> apiUrl: 'http://localhost:8787'
> ```

## Build de Producción

```bash
npm run build:prod    # ng build --configuration production
```

El output se genera en `dist/cotizador-notarial/`.

## Despliegue en Cloudflare Pages

1. Conectar el repositorio a Cloudflare Pages
2. Configurar:
   - **Build command**: `npm run build:prod`
   - **Build output directory**: `dist/cotizador-notarial`
3. Los archivos `_redirects` y `_headers` en `public/` se copian automáticamente al build

### Archivos de configuración de Pages

- **`_redirects`**: SPA catch-all (`/* → /index.html 200`)
- **`_headers`**: Security headers (X-Frame-Options, CSP, COOP, etc.)

## Estructura del Proyecto

```
src/app/
├── app.component.ts          # Shell: navbar, tema dinámico, PWA manifest
├── app.routes.ts             # /login, /cotizador, /historial
├── app.config.ts             # Firebase, HttpClient, Service Worker
├── core/
│   ├── services/
│   │   ├── api.service.ts        # HTTP client → Worker backend
│   │   ├── auth.service.ts       # Firebase Auth + contexto tenant
│   │   ├── calculator.service.ts # Motor de cálculo de precios
│   │   ├── offline.service.ts    # IndexedDB + auto-sync
│   │   └── pdf.service.ts        # Generación PDF (jsPDF)
│   └── utils/
│       └── date.utils.ts         # Formateo de fechas
├── features/
│   ├── login/                    # Google Sign-In
│   ├── cotizador/                # Calculadora + carrito
│   └── historial/                # Tabla de historial
└── shared/
    ├── components/
    │   └── switcher/             # Toggle input (moneda, etc.)
    └── directives/
        └── currency-format.directive.ts  # Formato numérico
```

## Características

### Cotizador
- Formulario reactivo con cálculo en tiempo real
- Soporta acumulado (un importe total) o detallado (por bien individual)
- Carrito de proforma (múltiples actos en una cotización)
- Edición de montos antes de generar el PDF
- Generación de PDF con o sin requisitos

### Historial
- Tabla paginada con carga progresiva
- Filtro por referencia interna o tipo de acto
- Regeneración de PDFs desde registros históricos

### PWA
- Service Worker para funcionamiento offline
- Manifest dinámico con branding de la notaría
- Sincronización automática al recuperar conexión

### Multi-tenant
- Branding dinámico (color, logo, nombre) según la notaría
- Favicon y título del navegador personalizados
- Manifest PWA con datos de la notaría

## Configuración Firebase

Los archivos `environment.ts` y `environment.prod.ts` contienen la configuración de Firebase:

```typescript
firebase: {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
}
```

> Las API keys de Firebase son públicas por diseño y están restringidas por dominio en la consola de Firebase.

## Testing

```bash
npm test          # Karma + Jasmine
```

## Dependencias Principales

| Paquete | Uso |
|---|---|
| `@angular/fire` | Firebase SDK para Angular |
| `jspdf` | Generación de PDFs client-side |
| `html2canvas` | Captura de DOM para PDFs (legacy) |
| `sweetalert2` | Notificaciones toast y diálogos |
| `firebase` | Firebase Auth SDK |
