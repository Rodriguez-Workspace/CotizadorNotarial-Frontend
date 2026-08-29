import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { SwitcherComponent } from '../../shared/components/switcher/switcher.component';
import { DataService } from '../../core/services/data.service';
import { ExchangeRateService, ExchangeRate } from '../../core/services/exchange-rate.service';
import { CalculatorService, TarifarioActo, ResultadoCalculo, CotizacionItem } from '../../core/services/calculator.service';
import { ApiService } from '../../core/services/api.service';
import { PdfService } from '../../core/services/pdf.service';
import { CacheService } from '../../core/services/cache.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyFormatDirective } from '../../shared/directives/currency-format.directive';
import { obtenerFechaFormateadaLetras } from '../../core/utils/date.utils';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-cotizador',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SwitcherComponent, CurrencyFormatDirective],
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
  
  // Variables del carrito
  carrito: CotizacionItem[] = [];
  notarialEditCtrl = new FormControl<number | null>(null);
  registralEditCtrl = new FormControl<number | null>(null);

  constructor(
    private fb: FormBuilder,
    private dataSvc: DataService,
    private tcSvc: ExchangeRateService,
    private calcSvc: CalculatorService,
    private apiSvc: ApiService,
    private pdfSvc: PdfService,
    private cacheSvc: CacheService,
    private datePipe: DatePipe,
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
    // Escuchar cambios en el contexto de la notaría para evitar consultar antes de que cargue
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
    
    this.carrito.push(item);
    
    // Resetear formulario para el siguiente acto, manteniendo la moneda global elegida
    this.form.patchValue({
      actoId: '',
      cantidadInmuebles: 1,
      conoceValor: false,
      importeTotal: null,
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
    // Remueve \ : * ? " < > | (el / sí está permitido)
    const sanitizado = input.value.replace(/[\\:*?"<>|]/g, '');
    if (input.value !== sanitizado) {
      this.form.get('referencia')?.setValue(sanitizado, { emitEvent: false });
      input.value = sanitizado;
    }
  }

  limpiarCarrito() {
    this.carrito = [];
  }

  updateFormArrays(conoceValor: boolean, cantidad: number) {
    this.valoresIndividuales.clear();
    
    // Si la cantidad excede el límite de 25, no generamos nada.
    if (cantidad > 25) {
      return;
    }

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
    this.uitActual = await this.dataSvc.getUIT();
    const actosFetch = await this.dataSvc.getTarifarioActos();
    this.actos = actosFetch.sort((a, b) => a.nombre.localeCompare(b.nombre));
    
    this.tcSvc.getExchangeRate().subscribe({
      next: (tc) => {
        // Regla de negocio: usar siempre el mayor entre compra y venta
        this.tcActual = Math.max(tc.compra, tc.venta);
        this.tcFecha = tc.fecha;
      },
      error: (e) => {
        // Silenciamos el error de CORS local en consola para evitar falsas alarmas, 
        // ya que la aplicación maneja el fallo correctamente usando 3.8
        this.tcActual = 3.8; // Fallback
      }
    });
  }

  async forzarActualizacion() {
    this.cacheSvc.clearAllCache();
    await this.initData();
    if (this.form.value.actoId) {
      // Re-buscar el acto seleccionado tras la recarga por si los requisitos cambiaron
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
      this.fechaFormateadaLetras,
      conRequisitos,
      this.fechaActual,
      this.form.value.referencia || ''
    );
  }

  generarPdfCarrito(conRequisitos: boolean) {
    if (this.carrito.length === 0) return;
    
    // Leemos la referencia directamente de la caja de texto en el instante en que se presiona el botón
    const refGlobal = this.form.value.referencia || '';

    this.pdfSvc.generarPdfMulti(
      this.carrito,
      this.fechaFormateadaLetras,
      conRequisitos,
      this.fechaActual,
      refGlobal
    );
  }

  guardarHistorialDirecto() {
    if (!this.resultados || !this.actoSeleccionado) return;
    const notariaName = this.auth.currentContext?.perfil.nombre_oficial || '';
    this.apiSvc.saveCotizacionMulti(
      [{
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
      }],
      '',
      notariaName
    );
  }

  getReferenciaGlobalCarrito(): string {
    return this.form.value.referencia || '';
  }

  guardarHistorialCarrito() {
    if (this.carrito.length === 0) return;
    const refGlobal = this.form.value.referencia || '';
    const notariaName = this.auth.currentContext?.perfil.nombre_oficial || '';
    this.apiSvc.saveCotizacionMulti(this.carrito, refGlobal, notariaName);
  }
}
