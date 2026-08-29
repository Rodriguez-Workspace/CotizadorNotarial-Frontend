// src/environments/environment.prod.ts — Producción (Cloudflare Pages)
export const environment = {
  production: true,
  firebase: {
    // ⚠️ Copiar los valores exactos del environment actual
    apiKey: "AIzaSyAFZjpmDXEfHN7qeMMQY6kxm-6ULow_OMY",
    authDomain: "cotizacionesnotariales.firebaseapp.com",
    projectId: "cotizacionesnotariales",
    storageBucket: "cotizacionesnotariales.firebasestorage.app",
    messagingSenderId: "488903124592",
    appId: "1:488903124592:web:7f5bdef96cd4926c2ef6b5",
    measurementId: "G-Y2L75GFRK0"
  },
  // URL del Worker desplegado en Cloudflare
  // Reemplazar con la URL real después de: npx wrangler deploy
  workerUrl: 'https://cotizador-worker.andres-dev.workers.dev'
};
