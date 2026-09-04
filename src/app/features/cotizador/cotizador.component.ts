/**
 * cotizador.component.ts — VERSIÓN MIGRADA (Cloudflare)
 *
 * Cambios respecto a la versión original:
 *  - DataService      → ApiService.getTarifarioActos() + getVariables()
 *  - ExchangeRateService → ApiService.getVariables()
 *  - SheetsService    → OfflineService.saveCotizaciones()
 *  - CacheService     → ApiService.clearCache()
 *
 * La lógica de cálculo, PDF, carrito y formulario NO cambió.
 */

import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, FormControl, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { SwitcherComponent } from '../../shared/components/switcher/switcher.component';
import { ApiService, CotizacionPayload } from '../../core/services/api.service';
import { OfflineService } from '../../core/services/offline.service';
import { CalculatorService, TarifarioActo, ResultadoCalculo, CotizacionItem } from '../../core/services/calculator.service';
import { PdfService } from '../../core/services/pdf.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyFormatDirective } from '../../shared/directives/currency-format.directive';
import { obtenerFechaFormateadaLetras } from '../../core/utils/date.utils';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-cotizador',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, SwitcherComponent, CurrencyFormatDirective],
  providers: [DatePipe],
  templateUrl: './cotizador.component.html',
})
export class CotizadorComponent implements OnInit {
  form: FormGroup;
  tcActual: number = 0;
  uitActual: number = 0;
  tcFecha: string = '';
  actos: TarifarioActo[] = [];
  actoSeleccionado: TarifarioActo | null = null;
  resultados: ResultadoCalculo | null = null;
  fechaActual: Date = new Date();
  
  carrito: CotizacionItem[] = [];
  referenciaGlobalCarrito: string = '';
  notarialEditCtrl = new FormControl<number | null>(null);
  registralEditCtrl = new FormControl<number | null>(null);

  // fechaActual se captura al montar el componente para mostrarla en la UI,
  // pero los PDFs y guardados usan new Date() en el instante del clic.

  constructor(
    private fb: FormBuilder,
    private apiSvc: ApiService,
    private offlineSvc: OfflineService,
    private calcSvc: CalculatorService,
    private pdfSvc: PdfService,
    private auth: AuthService
  ) {
    this.form = this.fb.group({
      actoId: ['', Validators.required],
      moneda: ['DOLARES', Validators.required],
      cantidadInmuebles: [1, [Validators.required, Validators.min(1), Validators.max(25), Validators.pattern('^[0-9]+$')]],
      conoceValor: [false],
      importeTotal: [null, [Validators.required, Validators.min(0.01)]],
      valoresIndividuales: this.fb.array([]),
      referencia: ['']
    });
  }

  ngOnInit() {
    this.auth.notariaContext$.subscribe(ctx => {
      if (ctx) {
        this.initData();
      }
    });
    
    this.form.get('conoceValor')?.valueChanges.subscribe(conoce => {
      this.updateFormArrays(conoce, this.form.get('cantidadInmuebles')?.value);
    });
    this.form.get('cantidadInmuebles')?.valueChanges.subscribe(cant => {
      if(this.form.get('conoceValor')?.value) {
        this.updateFormArrays(true, cant);
      }
    });
    this.form.get('actoId')?.valueChanges.subscribe(id => {
      this.actoSeleccionado = this.actos.find(a => a.id === id) || null;
    });
    
    this.form.valueChanges.subscribe(() => this.calcular());
  }

  get fechaFormateadaLetras(): string {
    return obtenerFechaFormateadaLetras(this.fechaActual);
  }

  get valoresIndividuales() {
    return this.form.get('valoresIndividuales') as FormArray;
  }

  get granTotalNotarial(): number {
    return this.carrito.reduce((sum, item) => sum + item.costoNotarialFinal, 0);
  }

  get granTotalRegistral(): number {
    return this.carrito.reduce((sum, item) => sum + item.costoRegistralFinal, 0);
  }

  get granTotalPagar(): number {
    return this.carrito.reduce((sum, item) => sum + item.totalFinal, 0);
  }
  
  get totalActualEditado(): number {
    const n = Number(this.notarialEditCtrl.value) || 0;
    const r = Number(this.registralEditCtrl.value) || 0;
    return n + r;
  }

  agregarAlCarrito() {
    if (!this.actoSeleccionado || !this.resultados) return;
    
    const item: CotizacionItem = {
      id: Date.now().toString(),
      acto: this.actoSeleccionado,
      moneda: this.form.value.moneda,
      cantidadInmuebles: this.form.value.cantidadInmuebles,
      conoceValores: this.form.value.conoceValor,
      importeAgrupado: this.form.value.importeTotal,
      importesIndividuales: this.form.value.valoresIndividuales,
      referencia: this.form.value.referencia,
      costoNotarialFinal: Number(this.notarialEditCtrl.value) || 0,
      costoRegistralFinal: Number(this.registralEditCtrl.value) || 0,
      totalFinal: this.totalActualEditado
    };
    
    // Heredar la referencia global de la última cotización agregada (si no está vacía)
    if (this.form.value.referencia && this.form.value.referencia.trim() !== '') {
      this.referenciaGlobalCarrito = this.form.value.referencia.trim();
    }

    this.carrito.push(item);
    
    this.form.patchValue({
      actoId: '',
      cantidadInmuebles: 1,
      conoceValor: false,
      importeTotal: null,
      referencia: ''
    });
    this.updateFormArrays(false, 1);
    this.actoSeleccionado = null;
    this.resultados = null;
    this.notarialEditCtrl.setValue(null, {emitEvent: false});
    this.registralEditCtrl.setValue(null, {emitEvent: false});
  }

  eliminarDelCarrito(index: number) {
    this.carrito.splice(index, 1);
  }

  sanitizarReferencia(event: Event) {
    const input = event.target as HTMLInputElement;
    const sanitizado = input.value.replace(/[\\:*?"<>|]/g, '');
    if (input.value !== sanitizado) {
      this.form.get('referencia')?.setValue(sanitizado, { emitEvent: false });
      input.value = sanitizado;
    }
  }

  limpiarCarrito() {
    this.carrito = [];
    this.referenciaGlobalCarrito = '';
  }

  updateFormArrays(conoceValor: boolean, cantidad: number) {
    this.valoresIndividuales.clear();
    
    if (cantidad > 25) return;

    if (conoceValor) {
      this.form.get('importeTotal')?.clearValidators();
      for (let i = 0; i < cantidad; i++) {
        this.valoresIndividuales.push(this.fb.control(null, [Validators.required, Validators.min(0.01)]));
      }
    } else {
      this.form.get('importeTotal')?.setValidators([Validators.required, Validators.min(0.01)]);
    }
    this.form.get('importeTotal')?.updateValueAndValidity();
  }

  async initData() {
    try {
      const [actosFetch, variables] = await Promise.all([
        this.apiSvc.getTarifarioActos(),
        this.apiSvc.getVariables()
      ]);
      
      this.actos = actosFetch; // Already sorted by the Worker
      this.uitActual = variables.UIT;
      this.tcActual = Math.max(variables.compra, variables.venta);
      this.tcFecha = variables.fecha_sunat;
    } catch (e) {
      console.error('Error loading data:', e);
      // Fallback values if Worker is unreachable
      this.uitActual = 5150;
      this.tcActual = 3.8;
    }
  }

  async forzarActualizacion() {
    this.apiSvc.clearCache();
    await this.initData();
    if (this.form.value.actoId) {
      this.actoSeleccionado = this.actos.find(a => a.id === this.form.value.actoId) || null;
      this.calcular();
    }
    Swal.fire({
      toast: true, position: 'top-end', showConfirmButton: false, timer: 2000,
      icon: 'success', title: 'Tarifario actualizado'
    });
  }

  calcular() {
    if (!this.actoSeleccionado || this.form.invalid) {
      this.resultados = null;
      this.notarialEditCtrl.setValue(null, {emitEvent: false});
      this.registralEditCtrl.setValue(null, {emitEvent: false});
      return;
    }

    const { moneda, cantidadInmuebles, conoceValor, importeTotal, valoresIndividuales } = this.form.value;

    this.resultados = this.calcSvc.calcular(
      importeTotal,
      moneda,
      this.tcActual,
      this.uitActual,
      this.actoSeleccionado,
      cantidadInmuebles,
      conoceValor,
      valoresIndividuales
    );
    this.notarialEditCtrl.setValue(this.resultados.costoNotarial, {emitEvent: false});
    this.registralEditCtrl.setValue(this.resultados.costoRegistral, {emitEvent: false});
  }

  generarPdfDirecto(conRequisitos: boolean) {
    if (!this.resultados || !this.actoSeleccionado) return;
    // Fix: capturar fecha/hora en el instante del clic, no al cargar la página
    const ahora = new Date();
    const item: CotizacionItem = {
      id: Date.now().toString(),
      acto: this.actoSeleccionado,
      moneda: this.form.value.moneda,
      cantidadInmuebles: this.form.value.cantidadInmuebles,
      conoceValores: this.form.value.conoceValor,
      importeAgrupado: this.form.value.importeTotal,
      importesIndividuales: this.form.value.valoresIndividuales,
      referencia: this.form.value.referencia,
      costoNotarialFinal: Number(this.notarialEditCtrl.value) || 0,
      costoRegistralFinal: Number(this.registralEditCtrl.value) || 0,
      totalFinal: this.totalActualEditado
    };

    this.pdfSvc.generarPdfMulti(
      [item],
      obtenerFechaFormateadaLetras(ahora),
      conRequisitos,
      ahora,
      this.form.value.referencia || ''
    );
  }

  generarPdfCarrito(conRequisitos: boolean) {
    if (this.carrito.length === 0) return;
    // Fix: capturar fecha/hora en el instante del clic
    const ahora = new Date();
    const refGlobal = this.form.value.referencia || '';
    this.pdfSvc.generarPdfMulti(this.carrito, obtenerFechaFormateadaLetras(ahora), conRequisitos, ahora, refGlobal);
  }

  // ─── Helpers para convertir CotizacionItem → CotizacionPayload ────────

  private itemToPayload(item: CotizacionItem): CotizacionPayload {
    const ahora = new Date();
    return {
      fecha:             ahora.toISOString(),
      referenciaInterna: item.referencia || '',
      tipoActo:          item.acto.nombre,
      moneda:            item.moneda,
      cantidadInmuebles: item.cantidadInmuebles,
      costoNotarial:     item.costoNotarialFinal,
      costoRegistral:    item.costoRegistralFinal,
      totalPagar:        item.totalFinal,
    };
  }

  guardarHistorialDirecto() {
    if (!this.resultados || !this.actoSeleccionado) return;
    const referencia = this.form.value.referencia || ''; // Fix: asegurar que la referencia viaje en guardado directo
    const item: CotizacionItem = {
      id: Date.now().toString(),
      acto: this.actoSeleccionado,
      moneda: this.form.value.moneda,
      cantidadInmuebles: this.form.value.cantidadInmuebles,
      conoceValores: this.form.value.conoceValor,
      importeAgrupado: this.form.value.importeTotal,
      importesIndividuales: this.form.value.valoresIndividuales,
      referencia,
      costoNotarialFinal: Number(this.notarialEditCtrl.value) || 0,
      costoRegistralFinal: Number(this.registralEditCtrl.value) || 0,
      totalFinal: this.totalActualEditado
    };
    this.offlineSvc.saveCotizaciones([this.itemToPayload(item)]);
  }

  getReferenciaGlobalCarrito(): string {
    return this.referenciaGlobalCarrito;
  }

  guardarHistorialCarrito() {
    if (this.carrito.length === 0) return;

    // Consolidar el carrito en un solo objeto payload tal como lo hacía la versión antigua
    const ahora = new Date();
    const referenciaGlobal = this.referenciaGlobalCarrito;
    
    const tipoActo = this.carrito.map(it => it.acto.nombre).join(' + ');
    const moneda = this.carrito[0].moneda;

    const cantidadInmuebles = this.carrito.reduce((sum, it) => sum + it.cantidadInmuebles, 0);
    const costoNotarial = this.carrito.reduce((sum, it) => sum + it.costoNotarialFinal, 0);
    const costoRegistral = this.carrito.reduce((sum, it) => sum + it.costoRegistralFinal, 0);
    const totalPagar = this.carrito.reduce((sum, it) => sum + it.totalFinal, 0);

    const consolidatedPayload: CotizacionPayload = {
      fecha:             ahora.toISOString(),
      referenciaInterna: referenciaGlobal,
      tipoActo:          tipoActo,
      moneda:            moneda,
      cantidadInmuebles: cantidadInmuebles,
      costoNotarial:     costoNotarial,
      costoRegistral:    costoRegistral,
      totalPagar:        totalPagar,
    };

    this.offlineSvc.saveCotizaciones([consolidatedPayload]);
  }
}
