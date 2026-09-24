import { TestBed } from '@angular/core/testing';
import { CalculatorService, TarifarioActo } from './calculator.service';

describe('CalculatorService', () => {
  let service: CalculatorService;

  const mockActoCompraventa: TarifarioActo = {
    id: 'COMPRAVENTA',
    nombre: 'Compraventa de Inmueble',
    costo_tramite: 250,
    tasa_registral_por_mil: 3.0,
    requisitos: [
      { id: 'req_001', texto: 'DNI del comprador' }
    ],
    rangos: [
      { min: 0, max: 50000, valor: 800 },
      { min: 50000, max: 200000, valor: 1500 },
      { min: 200000, max: null, valor: 2500 }
    ]
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CalculatorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('calcularCostoRegistralIndividual', () => {
    it('debe calcular correctamente la tasa registral y sumar el costo de trámite', () => {
      // 100,000 / 1000 * 3.0 = 300; 300 + 250 = 550
      const costo = service.calcularCostoRegistralIndividual(100000, 3.0, 250, 5350);
      expect(costo).toBe(550);
    });

    it('debe topar el costo registral al valor de la UIT si la fórmula lo excede', () => {
      // 2,000,000 / 1000 * 3.0 = 6000; 6000 + 250 = 6250 > 5350
      const costo = service.calcularCostoRegistralIndividual(2000000, 3.0, 250, 5350);
      expect(costo).toBe(5350);
    });
  });

  describe('obtenerCostoNotarial', () => {
    it('debe devolver 0 si no hay rangos definidos', () => {
      expect(service.obtenerCostoNotarial(50000, [])).toBe(0);
    });

    it('debe seleccionar el primer rango si el importe está dentro del primer límite', () => {
      // <= 50,000 -> 800
      expect(service.obtenerCostoNotarial(30000, mockActoCompraventa.rangos)).toBe(800);
      expect(service.obtenerCostoNotarial(50000, mockActoCompraventa.rangos)).toBe(800);
    });

    it('debe seleccionar el segundo rango intermedio', () => {
      // > 50,000 y <= 200,000 -> 1500
      expect(service.obtenerCostoNotarial(75000, mockActoCompraventa.rangos)).toBe(1500);
      expect(service.obtenerCostoNotarial(200000, mockActoCompraventa.rangos)).toBe(1500);
    });

    it('debe seleccionar el tramo superior abierto (max: null) correctamente', () => {
      // > 200,000 -> 2500
      expect(service.obtenerCostoNotarial(350000, mockActoCompraventa.rangos)).toBe(2500);
      expect(service.obtenerCostoNotarial(1000000, mockActoCompraventa.rangos)).toBe(2500);
    });

    it('debe heredar el valor del rango anterior si un rango tiene valor null', () => {
      const rangosConNull = [
        { min: 0, max: 50000, valor: 800 },
        { min: 50000, max: 100000, valor: null }
      ];
      expect(service.obtenerCostoNotarial(70000, rangosConNull)).toBe(800);
    });
  });

  describe('calcular (modo agrupado)', () => {
    it('debe calcular correctamente en Soles con 1 bien', () => {
      // 100,000 Soles, TC 3.75, UIT 5350
      // Dolares = 100000 / 3.75 = 26666.67 -> Notarial rango 1 = 800
      // Registral = (100000 / 1000 * 3) + 250 = 300 + 250 = 550
      // Total = 800 + 550 = 1350
      const resultado = service.calcular(
        100000,
        'SOLES',
        3.75,
        5350,
        mockActoCompraventa,
        1,
        false
      );

      expect(resultado.costoNotarial).toBe(800);
      expect(resultado.costoRegistral).toBe(550);
      expect(resultado.total).toBe(1350);
    });

    it('debe calcular correctamente en Dólares con conversión para SUNARP', () => {
      // 100,000 Dólares, TC 3.75, UIT 5350
      // Notarial = Rango 2 (>50,000 y <= 200,000) = 1500
      // Soles = 100,000 * 3.75 = 375,000
      // Registral = (375000 / 1000 * 3) + 250 = 1125 + 250 = 1375
      // Total = 1500 + 1375 = 2875
      const resultado = service.calcular(
        100000,
        'DOLARES',
        3.75,
        5350,
        mockActoCompraventa,
        1,
        false
      );

      expect(resultado.costoNotarial).toBe(1500);
      expect(resultado.costoRegistral).toBe(1375);
      expect(resultado.total).toBe(2875);
    });

    it('debe multiplicar el costo de trámite por la cantidad de bienes en modo agrupado', () => {
      // 2 bienes: costo_tramite = 250 * 2 = 500
      // 100,000 Soles, tasa 3 por mil = 300
      // Registral = 300 + 500 = 800
      const resultado = service.calcular(
        100000,
        'SOLES',
        3.75,
        5350,
        mockActoCompraventa,
        2,
        false
      );

      expect(resultado.costoRegistral).toBe(800);
    });
  });

  describe('calcular (modo detallado individual)', () => {
    it('debe calcular el costo registral por cada bien individualmente y el notarial sobre la suma total', () => {
      // 2 bienes en Soles: 60,000 y 40,000. Suma = 100,000 Soles.
      // Dolares total = 100000 / 3.75 = 26666.67 -> Notarial rango 1 = 800
      // Bien 1 registral: (60,000 / 1000 * 3) + 250 = 180 + 250 = 430
      // Bien 2 registral: (40,000 / 1000 * 3) + 250 = 120 + 250 = 370
      // Total registral = 430 + 370 = 800
      // Total general = 800 + 800 = 1600
      const resultado = service.calcular(
        0,
        'SOLES',
        3.75,
        5350,
        mockActoCompraventa,
        2,
        true,
        [60000, 40000]
      );

      expect(resultado.costoNotarial).toBe(800);
      expect(resultado.costoRegistral).toBe(800);
      expect(resultado.total).toBe(1600);
    });
  });
});
