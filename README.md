# Cotizador Notarial PWA (Plataforma SaaS Multi-Tenencia)

Aplicación web progresiva (PWA) desarrollada en **Angular 18** para automatizar el cálculo de costos notariales y registrales. La plataforma funciona bajo un modelo **SaaS (Software as a Service) Multi-Tenencia**, lo que significa que el mismo código fuente sirve a múltiples notarías simultáneamente, inyectando de manera dinámica la configuración, los colores y el logotipo correspondientes a cada cliente (notaría) según el usuario que inicie sesión.

## Características Principales

*   **Arquitectura Multi-Tenant:** Una sola PWA (desplegada en Firebase Hosting) da soporte a múltiples notarías. Al iniciar sesión, la plataforma identifica a qué notaría pertenece el empleado y adapta automáticamente los colores (`--color-marca`), el logotipo, el nombre de la pestaña y las consultas a la base de datos para ese entorno aislado.
*   **Autenticación Segura (Firebase Auth):** Acceso restringido con Google Sign-In. La capa de seguridad resuelve el contexto (`notaria_id`) consultando de forma estructurada los usuarios autorizados.
*   **Gestión Centralizada:** Todo el ecosistema (tarifarios, branding y listas de usuarios) está respaldado por Firestore, permitiendo actualización en tiempo real sin redesplegar la aplicación.
*   **Cotización Inteligente**: Permite ingresar importes en Soles o Dólares (con conversión automática usando el tipo de cambio oficial) y calcula honorarios notariales y tasas registrales. Incluye topes lógicos (ej. máximo 25 inmuebles) y precisión matemática estricta a 2 decimales.
*   **Gestión de Variables Globales (UIT)**: La UIT ya no se guarda manualmente, sino que se sincroniza automáticamente consultando a un API externo de la SUNAT, garantizando que los topes de ley siempre estén al día.
*   **Exportación a PDF**: Generación instantánea de proformas en formato PDF (`jspdf` + `html2canvas`). Incluye un robusto motor de sanitización de nombres de archivo que bloquea caracteres especiales e impide que los usuarios guarden accidentalmente archivos con nombres reservados de Windows (como `CON` o `PRN`).
*   **Proformas Múltiples (Carrito de Cotizaciones)**: Permite agregar varios actos notariales a una sola proforma consolidada y unificada bajo una única "Referencia Global". El carrito mantiene los datos visibles después de guardar, facilitando cambios de última hora.
*   **Historial en Google Sheets (Con Fallback Offline)**: Las cotizaciones se guardan directamente en Google Sheets. Si hay un error de conexión o la sesión de Google expira, el sistema respalda la data localmente usando `IndexedDB` y te notifica con elegancia a través de un discreto sistema de *Toasts*.
*   **UX Impecable y PWA Offline-Ready**: Diseño **TailwindCSS** + **SweetAlert2**. Incluye control de estados de carga (evitando el doble clic en el login), manejo de parpadeos visuales (Skeleton Loaders en el menú) y una navegación que se siente como una app nativa en móviles.

## Arquitectura Técnica

*   **Frontend:** Angular 18 (Standalone Components).
*   **Estilos:** TailwindCSS + PostCSS (Uso intensivo de CSS variables para White-Labeling).
*   **Backend / BaaS:** Firebase (Hosting, Firestore, Authentication, Cloud Storage).

## Estructura de Firebase Firestore (Multi-Tenant)

La base de datos sigue una estructura fuertemente jerárquica y particionada para garantizar que los datos de una notaría nunca se mezclen con los de otra:

*   **`notarias/{notaria_id}`**: Documento raíz de la notaría. Contiene metadatos, branding (color HEX, URL del logo) y credenciales de Google Sheets.
    *   **`.../usuarios_autorizados/{email}`**: Lista de empleados que pueden acceder al cotizador de esta notaría (contiene roles como `admin` o `user`).
    *   **`.../tarifario_actos/{acto_id}`**: Matriz de rangos, costos de trámite, tasas registrales y requisitos exclusivos de esta notaría.
    *   **`.../variables_globales/valores_actuales`**: Documento dinámico con la **UIT** y **Tipo de Cambio (Compra/Venta)** específicos (o sincronizados) para esta notaría.

## Configuración y Desarrollo Local

### 1. Requisitos Previos
*   Node.js (versión LTS)
*   Angular CLI (`npm i -g @angular/cli`)
*   Firebase CLI (`npm i -g firebase-tools`)

### 2. Instalación
```bash
npm install
```

### 3. Servidor de Desarrollo
```bash
npm run start
```
Luego navega a `http://localhost:4200/`.

## Construcción y Despliegue (Producción)

Para compilar la aplicación Angular optimizada y subirla a Firebase Hosting, utiliza:
```bash
npm run deploy
```
*(Este comando ejecuta internamente `ng build` seguido de `firebase deploy`)*
