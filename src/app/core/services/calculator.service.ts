import { Injectable } from '@angular/core';

export interface Rango {
  min: number;
  max: number;
  valor: number | null; 
}

export interface Requisito {
  id: string;
  texto: string;
}

export interface TarifarioActo {
  id: string;
  nombre: string;
  costo_tramite: number;
  tasa_registral_por_mil: number;
  requisitos: Requisito[];
  rangos: Rango[];
}

export interface ResultadoCalculo {
  costoNotarial: number;
  costoRegistral: number;
  total: number;
}

export interface CotizacionItem {
  id: string; // Unique ID for the cart item
  acto: TarifarioActo;
  moneda: 'DOLARES' | 'SOLES';
  cantidadInmuebles: number;
  conoceValores: boolean;
  importeAgrupado: number;
  importesIndividuales: number[];
  referencia: string;
  // Estos son los resultados guardados (incluyendo la edición manual si hubo)
  costoNotarialFinal: number;
  costoRegistralFinal: number;
  totalFinal: number;
}

@Injectable({
  providedIn: 'root'
})
export class CalculatorService {

  constructor() { }

  calcularCostoRegistralIndividual(importeSoles: number, tasa: number, costoTramite: number, uit: number): number {
    let costo = ((importeSoles / 1000) * tasa) + costoTramite;
    return Math.min(costo, uit);
  }

  obtenerCostoNotarial(importeDolares: number, rangos: Rango[]): number {
    if (!rangos || rangos.length === 0) return 0;
    
    // Los rangos ya vienen ordenados desde DataService
    for (let i = 0; i < rangos.length; i++) {
      const rango = rangos[i];
      
      if (importeDolares <= rango.max) {
        if (rango.valor === null) {
          // Regla de Interpolación Null: retroceder un escalón
          if (i > 0) {
            return rangos[i - 1].valor || 0;
          }
          return 0; 
        }
        return rango.valor;
      }
    }
    
    // Si supera el último rango
    const ultimoRango = rangos[rangos.length - 1];
    if (ultimoRango.valor === null && rangos.length > 1) {
       return rangos[rangos.length - 2].valor || 0;
    }
    return ultimoRango.valor || 0;
  }

  calcular(
    importeTotalAgrupado: number,
    moneda: 'DOLARES' | 'SOLES',
    tc: number,
    uit: number,
    acto: TarifarioActo,
    cantidadInmuebles: number,
    conoceValores: boolean,
    importesIndividuales: number[] = []
  ): ResultadoCalculo {
    
    let costoRegistral = 0;
    const importeSolesTotal = moneda === 'SOLES' ? importeTotalAgrupado : importeTotalAgrupado * tc;
    const importeDolaresTotal = moneda === 'DOLARES' ? importeTotalAgrupado : importeTotalAgrupado / tc;

    if (!conoceValores) {
      // MODO RÁPIDO
      const totalTramite = acto.costo_tramite * cantidadInmuebles;
      costoRegistral = ((importeSolesTotal / 1000) * acto.tasa_registral_por_mil) + totalTramite;
      costoRegistral = Math.min(costoRegistral, uit); 
    } else {
      // MODO DETALLADO
      for (const imp of importesIndividuales) {
        const impSol = moneda === 'SOLES' ? imp : imp * tc;
        costoRegistral += this.calcularCostoRegistralIndividual(impSol, acto.tasa_registral_por_mil, acto.costo_tramite, uit);
      }
    }

    // Costo Notarial (La tabla de rangos se lee comparando Dólares)
    // El valor que devuelve la tabla (acto.rangos) ya está en SOLES, por lo que NO se debe multiplicar ni dividir.
    // Solo mostramos el número extraído.
    const costoNotarialRaw = this.obtenerCostoNotarial(importeDolaresTotal, acto.rangos);

    const costoNotarialFinal = Number(costoNotarialRaw.toFixed(2));
    const costoRegistralFinal = Number(costoRegistral.toFixed(2));

    return {
      costoNotarial: costoNotarialFinal,
      costoRegistral: costoRegistralFinal,
      total: Number((costoNotarialFinal + costoRegistralFinal).toFixed(2))
    };
  }
}
