import { Injectable } from '@angular/core';
import { TarifarioActo } from './calculator.service';
import { ActoDictionaryEntry, DICCIONARIO_ACTOS } from '../data/diccionario-actos.data';

export interface MatchHint {
  tipo: 'Sinónimo' | 'Abreviatura' | 'Corrección';
  texto: string;
}

@Injectable({
  providedIn: 'root'
})
export class ActosDictionaryService {
  private readonly dictionary: ActoDictionaryEntry[] = DICCIONARIO_ACTOS;
  private readonly entryCache = new Map<string, ActoDictionaryEntry | null>();

  /**
   * Normaliza una cadena de texto:
   * - Convierte a minúsculas
   * - Remueve acentos / tildes diacríticas (á->a, é->e, etc.)
   * - Elimina espacios sobrantes
   */
  normalize(text: string | null | undefined): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  /**
   * Limpia una cadena de texto dejando únicamente caracteres alfanuméricos.
   * Muy útil para comparar siglas y abreviaturas como "e/p", "ep", "e.p.", "c/v", "cv".
   */
  clean(text: string | null | undefined): string {
    return this.normalize(text).replace(/[^a-z0-9]/g, '');
  }

  /**
   * Divide una cadena en palabras/tokens ignorando puntuación.
   */
  tokenize(text: string | null | undefined): string[] {
    return this.normalize(text).split(/[\s,./\-_()]+/).filter(Boolean);
  }

  /**
   * Evalúa si una cadena objetivo (target) coincide con un término de búsqueda (query).
   */
  stringMatchesQuery(target: string | null | undefined, query: string | null | undefined): boolean {
    const nt = this.normalize(target);
    const nq = this.normalize(query);
    if (!nq) return true;
    if (!nt) return false;

    // 1. Coincidencia exacta de frase
    if (nt === nq) return true;

    // 2. Coincidencia alfanumérica limpia (ej: "c/v" vs "cv", "e/p" vs "ep")
    const ct = this.clean(target);
    const cq = this.clean(query);
    if (ct === cq) return true;
    if (cq.length >= 2 && (ct.startsWith(cq) || (cq.length <= 4 && ct.endsWith(cq)))) return true;

    // 3. Coincidencia multi-token
    const qTokens = this.tokenize(query);
    const tWords = this.tokenize(target);

    if (qTokens.length === 0) return true;

    return qTokens.every(qTok => {
      // Palabra idéntica
      if (tWords.includes(qTok)) return true;
      // Palabra que empieza con el token
      if (tWords.some(tw => tw.startsWith(qTok))) return true;
      // Si el token tiene 4+ letras, buscar coincidencia parcial en palabras largas
      if (qTok.length >= 4 && tWords.some(tw => tw.length >= 5 && tw.includes(qTok))) return true;
      return false;
    });
  }

  /**
   * Obtiene la entrada correspondiente del diccionario para un acto del tarifario.
   */
  getDictionaryEntry(acto: TarifarioActo | null | undefined): ActoDictionaryEntry | null {
    if (!acto || !acto.id) return null;
    if (this.entryCache.has(acto.id)) {
      return this.entryCache.get(acto.id) ?? null;
    }

    const nId = this.normalize(acto.id);
    const nNombre = this.normalize(acto.nombre);
    const cId = this.clean(acto.id);
    const cNombre = this.clean(acto.nombre);

    // 1. Coincidencia directa por nombre oficial o id
    let entry = this.dictionary.find(e => {
      const ne = this.normalize(e.acto);
      const ce = this.clean(e.acto);
      return ne === nId || ne === nNombre || ce === cId || ce === cNombre;
    });

    // 2. Coincidencia si el nombre está registrado en los sinónimos del diccionario
    if (!entry) {
      entry = this.dictionary.find(e =>
        (e.sinonimos || []).some(s => {
          const ns = this.normalize(s);
          return ns === nNombre || ns === nId;
        })
      );
    }

    // 3. Coincidencia por contención mutua
    if (!entry) {
      entry = this.dictionary.find(e => {
        const ne = this.normalize(e.acto);
        return (ne.length > 4 && (ne.includes(nNombre) || nNombre.includes(ne)));
      });
    }

    const result = entry ?? null;
    this.entryCache.set(acto.id, result);
    return result;
  }

  /**
   * Determina si un acto del tarifario coincide con el término de búsqueda,
   * ya sea por su propio nombre/id o por sus sinónimos, abreviaturas o correcciones del diccionario.
   */
  matches(acto: TarifarioActo, query: string): boolean {
    if (!query || !query.trim()) return true;

    // 1. Coincidencia directa en el nombre oficial o ID
    if (this.stringMatchesQuery(acto.nombre, query) || this.stringMatchesQuery(acto.id, query)) {
      return true;
    }

    // 2. Coincidencia mediante el diccionario enriquecido
    const entry = this.getDictionaryEntry(acto);
    if (!entry) return false;

    // Verificar abreviaturas
    if ((entry.abreviaturas || []).some(a => this.stringMatchesQuery(a, query))) {
      return true;
    }

    // Verificar sinónimos
    if ((entry.sinonimos || []).some(s => this.stringMatchesQuery(s, query))) {
      return true;
    }

    // Verificar errores/variaciones comunes
    if ((entry.errores || []).some(e => this.stringMatchesQuery(e, query))) {
      return true;
    }

    return false;
  }

  /**
   * Verifica si el nombre principal ya contiene explícitamente el término buscado
   * (como palabra exacta o prefijo de palabra), en cuyo caso no se necesita un badge extra.
   */
  nameClearlyMatches(nombre: string | null | undefined, query: string): boolean {
    const nq = this.normalize(query);
    const words = this.tokenize(nombre);
    const qWords = this.tokenize(query);

    if (qWords.length === 1) {
      return words.some(w => w === nq || w.startsWith(nq));
    } else if (qWords.length > 1) {
      return qWords.every(qw => words.some(w => w === qw || w.startsWith(qw)));
    }
    return false;
  }

  /**
   * Devuelve un hint visual indicando con qué sinónimo, abreviatura o corrección
   * coincidió la búsqueda si el nombre principal no contiene directamente la consulta.
   */
  getHint(acto: TarifarioActo, query: string): MatchHint | null {
    if (!query || !query.trim()) return null;

    // Si el nombre oficial ya incluye claramente el término buscado, no mostramos badge extra
    if (this.nameClearlyMatches(acto.nombre, query)) {
      return null;
    }

    const entry = this.getDictionaryEntry(acto);
    if (!entry) return null;

    const cq = this.clean(query);

    // Prioridad 1: Coincidencia exacta con un término en abreviaturas, errores o sinónimos
    const exactAbv = (entry.abreviaturas || []).find(a => this.clean(a) === cq);
    if (exactAbv) {
      return { tipo: 'Abreviatura', texto: exactAbv };
    }

    const exactErr = (entry.errores || []).find(e => this.clean(e) === cq);
    if (exactErr) {
      return { tipo: 'Corrección', texto: exactErr };
    }

    const exactSyn = (entry.sinonimos || []).find(s => this.clean(s) === cq);
    if (exactSyn) {
      return { tipo: 'Sinónimo', texto: exactSyn };
    }

    // Prioridad 2: Coincidencia por palabra clave / token / prefijo
    const abv = (entry.abreviaturas || []).find(a => this.stringMatchesQuery(a, query));
    if (abv) {
      return { tipo: 'Abreviatura', texto: abv };
    }

    const syn = (entry.sinonimos || []).find(s => this.stringMatchesQuery(s, query));
    if (syn) {
      return { tipo: 'Sinónimo', texto: syn };
    }

    const err = (entry.errores || []).find(e => this.stringMatchesQuery(e, query));
    if (err) {
      return { tipo: 'Corrección', texto: err };
    }

    return null;
  }

  /**
   * Limpia la caché interna de mapeo de actos a entradas del diccionario.
   */
  clearCache(): void {
    this.entryCache.clear();
  }
}
