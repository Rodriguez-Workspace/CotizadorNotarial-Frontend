import { Injectable } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

export interface ExchangeRate {
  compra: number;
  venta: number;
  origen: string;
  moneda: string;
  fecha: string;
}

@Injectable({
  providedIn: 'root'
})
export class ExchangeRateService {
  constructor(private firestore: Firestore) {}

  getExchangeRate(): Observable<ExchangeRate> {
    const docRef = doc(this.firestore, 'variables_globales/valores_actuales');
    
    // Usamos getDoc() y lo convertimos a Observable con from() para asegurar que 
    // siempre se intente traer la versión más reciente del servidor al hacer click 
    // en actualizar, en lugar de recibir inmediatamente la versión en memoria de docData.
    return from(getDoc(docRef)).pipe(
      map((docSnap) => {
        if (!docSnap.exists()) {
          throw new Error('No se encontraron datos de tipo de cambio en Firestore');
        }
        const data = docSnap.data();
        return {
          compra: data['compra'],
          venta: data['venta'],
          origen: data['origen'] || 'SUNAT',
          moneda: data['moneda'] || 'USD',
          // Mapeamos 'fecha_sunat' a 'fecha' para no romper la interfaz existente en tu frontend
          fecha: data['fecha_sunat']
        } as ExchangeRate;
      })
    );
  }

  // Mantenemos este método vacío por si algún componente (como un botón de refrescar) lo está llamando.
  clearCache(): void {
  }
}
