# CotizadorNotarial — Frontend

Aplicación web progresiva (PWA) para abogados de notarías que permite cotizar actos notariales y registrales de forma rápida, generar PDFs de presupuesto y consultar el historial de cotizaciones.

---

## Stack

| Tecnología | Uso |
|---|---|
| **Angular 17** | Framework SPA (standalone components) |
| **TailwindCSS** | Utilidades CSS |
| **Firebase JS SDK** | Autenticación (Auth), contexto de usuario |
| **@angular/fire** | Integración Angular ↔ Firebase |
| **@angular/service-worker** | PWA — caché offline y actualizaciones automáticas |
| **jsPDF** | Generación de PDFs en el navegador |
| **SweetAlert2** | Modales y toasts de notificación |
| **Dexie.js** | IndexedDB — guardado offline |

---

## Estructura de Carpetas

```
src/
├── app/
│   ├── app.component.ts           # Root: theming dinámico + Service Worker updates
│   ├── app.config.ts              # Providers globales (Router, Firebase, SW)
│   ├── app.routes.ts              # Rutas lazy-loaded con AuthGuard
│   ├── core/
│   │   └── services/
│   │       ├── auth.service.ts        # Sesión + notariaContext$
│   │       ├── api.service.ts         # Comunicación con el backend (Cloudflare Worker)
│   │       ├── calculator.service.ts  # Lógica de cálculo de aranceles
│   │       ├── pdf.service.ts         # Generación de PDFs con jsPDF
│   │       └── offline.service.ts     # Guardado en IndexedDB + sincronización
│   ├── features/
│   │   ├── cotizador/             # Formulario de cotización + carrito
│   │   ├── historial/             # Tabla paginada del historial
│   │   └── login/                 # Pantalla de inicio de sesión
│   └── shared/
│       ├── components/
│       │   └── switcher/          # Toggle "Acumulado / Individual"
│       └── directives/
│           └── currency-format.directive.ts  # Formateo de moneda en inputs
├── environments/
│   ├── environment.ts             # Desarrollo
│   └── environment.prod.ts        # Producción
└── ngsw-config.json               # Configuración del Service Worker
```

---

## Variables de Entorno

En `src/environments/environment.prod.ts`:

```typescript
export const environment = {
  production: true,
  apiUrl: 'https://tu-worker.workers.dev',
  firebase: {
    apiKey: 'AIza...',
    authDomain: 'tu-proyecto.firebaseapp.com',
    projectId: 'tu-proyecto',
    storageBucket: 'tu-proyecto.firebasestorage.app',
    messagingSenderId: '...',
    appId: '...'
  }
};
```

> **Nota:** Las `apiKey` de Firebase para clientes web son seguras de incluir en el código — el acceso a los datos está protegido por las reglas de Firestore, no por la clave pública.

---

## Desarrollo Local

```bash
npm install
npm run start    # ng serve — servidor en http://localhost:4200
```

---

## Construcción para Producción

```bash
npm run build    # ng build --configuration=production
```

Los archivos de salida se generan en `dist/cotizador-notarial/browser/`. Este directorio se despliega en Cloudflare Pages.

---

## Despliegue (Cloudflare Pages)

El despliegue se puede configurar de dos maneras:

**Automático (recomendado):** Conectar el repositorio de GitHub a Cloudflare Pages. Cada push a `main` desplegará automáticamente.

**Manual:**
```bash
npm run build
npx wrangler pages deploy dist/cotizador-notarial/browser
```

---

## Servicios Principales

### `AuthService`
Maneja el estado de sesión. Expone `notariaContext$` (Observable) con el contexto completo de la notaría del usuario autenticado: perfil, rol, spreadsheetId.

### `ApiService`
Único punto de contacto con el backend. En cada llamada:
1. Obtiene el Firebase ID Token fresco desde `AuthService`.
2. Lo adjunta en `Authorization: Bearer`.
3. Si el backend responde `401/403`, hace logout automático.

Mantiene caché en memoria para: `tenant`, `tarifario`, `variables` (invalidable con el botón "Actualizar Ahora").

### `CalculatorService`
Lógica de cálculo de aranceles. Dado un acto, importe, moneda y tipo de cambio, calcula:
- **Costo Notarial**: Busca el rango de precio correspondiente al valor en USD.
- **Costo Registral**: `tasa_registral_por_mil × valor_USD / 1000`.
- **Total a Pagar**: Suma de ambos, convertida a la moneda seleccionada.

### `PdfService`
Genera PDFs usando `jsPDF` directamente en el navegador (sin servidor). Soporta:
- PDF con o sin lista de requisitos.
- Logo de la notaría descargado desde Firebase Storage.
- Branding dinámico con el color de marca de la notaría.

### `OfflineService`
Guarda cotizaciones en IndexedDB (Dexie.js) cuando el backend no está disponible. Cuando vuelve la conectividad, las sincroniza automáticamente.

---

## Flujo del Cotizador

```
1. Seleccionar Tipo de Acto (lista del tarifario de la notaría)
2. Seleccionar Moneda (SOLES / DÓLARES)
3. Indicar cantidad de bienes
4. Si acto = "OTROS": escribir nombre del acto y añadir requisitos personalizados
5. Ingresar valor(es) del bien (acumulado o individual por bien)
6. El sistema calcula automáticamente los costos
7. El abogado puede ajustar manualmente los montos finales
8. Opciones:
   a. Añadir al Carrito (proforma multi-acto)
   b. Generar PDF directo
   c. Guardar en historial (Google Sheets)
```

---

## PWA y Service Worker

La app es una Progressive Web App completa:

- **Instalable** en el dispositivo como app nativa.
- **Funciona offline** gracias al caché de assets del Service Worker.
- **Actualización automática**: Cuando se publica una nueva versión en Cloudflare Pages, el Service Worker detecta el cambio en segundo plano y muestra un aviso (`SweetAlert2`) pidiendo al usuario que actualice. Al confirmar, recarga la página con el nuevo código sin perder el trabajo guardado.

### Ciclo de actualización
```
Deploy en Cloudflare Pages
        │
        ▼
Service Worker detecta cambio (en background, sin acción del usuario)
        │
        ▼
SweetAlert: "Nueva versión disponible → Actualizar ahora"
        │
        ▼
window.location.reload() → Nuevo código en memoria
```

---

## Seguridad del Frontend

- **Autenticación**: Firebase Auth con Google OAuth o Email/Password.
- **Tokens**: Firebase ID Tokens con duración de 1 hora. Se renuevan automáticamente.
- **Sin datos sensibles en localStorage**: El token se obtiene siempre con `getIdToken()` que maneja el refresh internamente.
- **CSP**: La app Angular por sí misma no ejecuta HTML dinámico. No usa `innerHTML` con datos de usuario.
- **Validación de inputs**: Los campos de montos solo aceptan números (directiva `CurrencyFormatDirective` + `keypress`). El nombre de acto personalizado acepta texto libre (sin restricciones, ya que es para uso interno).
