import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { TarifarioActo, Rango } from './calculator.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private auth = inject(AuthService);
  private firestore = inject(Firestore);

  private getCacheKey(type: string): string {
    const notariaId = this.auth.currentContext?.id || 'default';
    return `${type}_${notariaId}`;
  }

  private isCacheValid(): boolean {
    const today = new Date().toLocaleDateString('en-CA');
    const cachedDate = localStorage.getItem(this.getCacheKey('data_date'));
    return cachedDate === today;
  }

  private setCacheDate(): void {
    const today = new Date().toLocaleDateString('en-CA');
    localStorage.setItem(this.getCacheKey('data_date'), today);
  }

  async getUIT(): Promise<number> {
    if (this.isCacheValid()) {
      const cached = localStorage.getItem(this.getCacheKey('uit'));
      if (cached) return parseFloat(cached);
    }
    
    try {
      const ref = doc(this.firestore, 'variables_globales', 'valores_actuales');
      const docSnap = await getDoc(ref);
      if (docSnap.exists()) {
        const uit = docSnap.data()['UIT'] || 5500;
        localStorage.setItem(this.getCacheKey('uit'), uit.toString());
        this.setCacheDate();
        return uit;
      }
    } catch (e) {
      console.error('Error fetching UIT, using default.', e);
    }
    return 5500; 
  }

  async getTarifarioActos(): Promise<TarifarioActo[]> {
    if (this.isCacheValid()) {
      const cached = localStorage.getItem(this.getCacheKey('actos'));
      if (cached) return JSON.parse(cached);
    }
    
    try {
      const notariaId = this.auth.currentContext?.id;
      if (!notariaId) throw new Error("No hay contexto de notaría activo");

      const docRef = doc(this.firestore, 'notarias', notariaId);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) return [];
      
      const data = docSnap.data();
      const actosMap = data['tarifario_actos'] || {};
      const catalogoReqs = data['requisitos_catalogo'] || {};
      
      const actos: TarifarioActo[] = [];
      
      for (const [key, actoData] of Object.entries<any>(actosMap)) {
        // Resolver IDs de requisitos a sus textos reales
        const reqIds = actoData.requisitos_asociados || [];
        const requisitosObjetos = reqIds
          .map((id: string) => ({ id: id, texto: catalogoReqs[id] || id }))
          .filter((req: {id: string, texto: string}) => req.texto.trim() !== '');

        const rangos: Rango[] = Array.isArray(actoData.rangos) ? actoData.rangos : [];
        rangos.sort((a, b) => a.min - b.min);

        actos.push({ 
          id: key, 
          nombre: key.replace(/_/g, ' '),
          costo_tramite: actoData.costo_tramite || 0,
          tasa_registral_por_mil: actoData.tasa_registral_por_mil || 0,
          requisitos: requisitosObjetos,
          rangos: rangos
        });
      }
      
      localStorage.setItem(this.getCacheKey('actos'), JSON.stringify(actos));
      this.setCacheDate();
      return actos;
    } catch (e) {
      console.error('Error fetching tarifario', e);
      return [];
    }
  }

  clearCache(): void {
    localStorage.removeItem(this.getCacheKey('uit'));
    localStorage.removeItem(this.getCacheKey('actos'));
    localStorage.removeItem(this.getCacheKey('data_date'));
  }
}

