// src/environments/environment.ts — Desarrollo local
export const environment = {
  production: false,
  firebase: {
    apiKey: "AIzaSyAFZjpmDXEfHN7qeMMQY6kxm-6ULow_OMY",
    authDomain: "cotizacionesnotariales.firebaseapp.com",
    projectId: "cotizacionesnotariales",
    storageBucket: "cotizacionesnotariales.firebasestorage.app",
    messagingSenderId: "488903124592",
    appId: "1:488903124592:web:7f5bdef96cd4926c2ef6b5",
    measurementId: "G-Y2L75GFRK0"
  },
  // URL del Worker en desarrollo local (ejecutar: npm run dev en el backend)
  workerUrl: 'http://localhost:8787'
};
