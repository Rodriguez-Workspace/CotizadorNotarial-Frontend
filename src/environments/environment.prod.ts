// En producción, la URL del Worker se inyecta vía variable de entorno API_URL
// configurada en Cloudflare Pages → Settings → Environment variables.
// El script replace-env.js (ejecutado durante el build de CF Pages) sustituye
// el placeholder por el valor real.
export const environment = {
  production: true,
  apiUrl: '__API_URL__',
  firebase: {
    apiKey: "AIzaSyAFZjpmDXEfHN7qeMMQY6kxm-6ULow_OMY",
    authDomain: "cotizacionesnotariales.firebaseapp.com",
    projectId: "cotizacionesnotariales",
    storageBucket: "cotizacionesnotariales.firebasestorage.app",
    messagingSenderId: "488903124592",
    appId: "1:488903124592:web:7f5bdef96cd4926c2ef6b5",
    measurementId: "G-Y2L75GFRK0"
  }
};
