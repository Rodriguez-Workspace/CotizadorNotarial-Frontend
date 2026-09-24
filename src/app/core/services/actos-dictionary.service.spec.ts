import { TestBed } from '@angular/core/testing';
import { ActosDictionaryService } from './actos-dictionary.service';
import { TarifarioActo } from './calculator.service';

describe('ActosDictionaryService', () => {
  let service: ActosDictionaryService;

  const mockActoCompraventa: TarifarioActo = {
    id: 'C/V DE INMUEBLE',
    nombre: 'C/V DE INMUEBLE',
    costo_tramite: 350,
    tasa_registral_por_mil: 3,
    requisitos: [],
    rangos: []
  };

  const mockActoCompraventaAmigable: TarifarioActo = {
    id: 'COMPRAVENTA',
    nombre: 'Compraventa de Inmueble',
    costo_tramite: 350,
    tasa_registral_por_mil: 3,
    requisitos: [],
    rangos: []
  };

  const mockActoAnticipo: TarifarioActo = {
    id: 'ANTICIPO DE HERENCIA/LEGÍTIMA DE INM.',
    nombre: 'ANTICIPO DE HERENCIA/LEGÍTIMA DE INM.',
    costo_tramite: 400,
    tasa_registral_por_mil: 3,
    requisitos: [],
    rangos: []
  };

  const mockActoHipoteca: TarifarioActo = {
    id: 'HIPOTECA',
    nombre: 'HIPOTECA',
    costo_tramite: 450,
    tasa_registral_por_mil: 1.5,
    requisitos: [],
    rangos: []
  };

  const mockActoCustom: TarifarioActo = {
    id: 'CUSTOM_999999',
    nombre: 'Trámite Especializado No En Catálogo',
    costo_tramite: 100,
    tasa_registral_por_mil: 0,
    requisitos: [],
    rangos: []
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ActosDictionaryService);
  });

  it('debe crearse correctamente', () => {
    expect(service).toBeTruthy();
  });

  describe('Normalización y limpieza', () => {
    it('debe normalizar tildes, mayúsculas y espacios', () => {
      expect(service.normalize('  ACLARACIÓN DE ESCRITURA PÚBLICA  ')).toBe('aclaracion de escritura publica');
      expect(service.normalize('ADOPCIÓN')).toBe('adopcion');
      expect(service.normalize(null)).toBe('');
    });

    it('debe limpiar caracteres no alfanuméricos', () => {
      expect(service.clean('c/v')).toBe('cv');
      expect(service.clean('E.P.')).toBe('ep');
      expect(service.clean('a.l.')).toBe('al');
    });
  });

  describe('Búsqueda de actos (matches)', () => {
    it('debe retornar true si el término de búsqueda está vacío', () => {
      expect(service.matches(mockActoCompraventa, '')).toBeTrue();
      expect(service.matches(mockActoCompraventa, '   ')).toBeTrue();
    });

    it('debe coincidir por nombre directo o ID', () => {
      expect(service.matches(mockActoCompraventa, 'inmueble')).toBeTrue();
      expect(service.matches(mockActoHipoteca, 'hipoteca')).toBeTrue();
      expect(service.matches(mockActoHipoteca, 'HIPO')).toBeTrue();
    });

    it('debe coincidir por sinónimos comunes del diccionario', () => {
      // "casa" o "departamento" o "terreno" para C/V DE INMUEBLE
      expect(service.matches(mockActoCompraventa, 'casa')).toBeTrue();
      expect(service.matches(mockActoCompraventa, 'departamento')).toBeTrue();
      expect(service.matches(mockActoCompraventa, 'terreno')).toBeTrue();
      expect(service.matches(mockActoCompraventaAmigable, 'casa')).toBeTrue();

      // "adelanto de herencia" para ANTICIPO
      expect(service.matches(mockActoAnticipo, 'adelanto de herencia')).toBeTrue();
      expect(service.matches(mockActoAnticipo, 'heredar en vida')).toBeTrue();
    });

    it('debe coincidir por abreviaturas', () => {
      expect(service.matches(mockActoCompraventa, 'cv')).toBeTrue();
      expect(service.matches(mockActoCompraventa, 'c/v')).toBeTrue();
      expect(service.matches(mockActoCompraventaAmigable, 'cv')).toBeTrue();
      expect(service.matches(mockActoAnticipo, 'al')).toBeTrue();
    });

    it('debe coincidir por errores tipográficos / ortográficos comunes', () => {
      // "conpraventa" o "inmeuble" o "compra benta"
      expect(service.matches(mockActoCompraventa, 'conpraventa')).toBeTrue();
      expect(service.matches(mockActoCompraventa, 'inmeuble')).toBeTrue();

      // "erencia" o "legitima" sin tilde
      expect(service.matches(mockActoAnticipo, 'erencia')).toBeTrue();
      expect(service.matches(mockActoAnticipo, 'antisispo')).toBeTrue();

      // "ipoteca" para HIPOTECA
      expect(service.matches(mockActoHipoteca, 'ipoteca')).toBeTrue();
    });

    it('debe soportar consultas compuestas con múltiples palabras', () => {
      expect(service.matches(mockActoCompraventa, 'compra casa')).toBeTrue();
      expect(service.matches(mockActoCompraventa, 'venta departamento')).toBeTrue();
      expect(service.matches(mockActoAnticipo, 'anticipo legitima')).toBeTrue();
    });

    it('debe manejar trámites personalizados (custom) correctamente', () => {
      expect(service.matches(mockActoCustom, 'especializado')).toBeTrue();
      expect(service.matches(mockActoCustom, 'casa')).toBeFalse();
    });
  });

  describe('Generación de hints (getHint)', () => {
    it('debe devolver null si el query está vacío', () => {
      expect(service.getHint(mockActoCompraventa, '')).toBeNull();
    });

    it('debe devolver null si el nombre principal ya contiene el término', () => {
      expect(service.getHint(mockActoHipoteca, 'hipoteca')).toBeNull();
      expect(service.getHint(mockActoCompraventa, 'inmueble')).toBeNull();
    });

    it('debe generar hint de Sinónimo cuando coincide por sinónimo', () => {
      const hint = service.getHint(mockActoCompraventa, 'casa');
      expect(hint).not.toBeNull();
      expect(hint?.tipo).toBe('Sinónimo');
      expect(hint?.texto).toContain('casa');
    });

    it('debe generar hint de Abreviatura cuando coincide por sigla', () => {
      const hint = service.getHint(mockActoCompraventaAmigable, 'cv');
      expect(hint).not.toBeNull();
      expect(hint?.tipo).toBe('Abreviatura');
      expect(hint?.texto).toBe('cv');
    });

    it('debe generar hint de Corrección cuando coincide por error común', () => {
      const hint = service.getHint(mockActoHipoteca, 'ipoteca');
      expect(hint).not.toBeNull();
      expect(hint?.tipo).toBe('Corrección');
      expect(hint?.texto).toBe('ipoteca');
    });
  });
});
