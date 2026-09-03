/**
 * historial.component.ts — VERSIÓN MIGRADA (Cloudflare)
 *
 * Cambios respecto a la versión original:
 *  - SheetsService → ApiService.getHistorial()
 *  - DataService   → ApiService.getTarifarioActos()
 *
 * La lógica de paginación, filtro y regeneración de PDF NO cambió.
 */

import { Component, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, CotizacionPayload } from '../../core/services/api.service';
import { PdfService } from '../../core/services/pdf.service';
import { TarifarioActo, CotizacionItem } from '../../core/services/calculator.service';
import { obtenerFechaFormateadaLetras } from '../../core/utils/date.utils';

@Component({
  selector: 'app-historial',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule],
  providers: [DatePipe],
  templateUrl: './historial.component.html',
})
export class HistorialComponent implements OnInit {
  registros: CotizacionPayload[] = [];
  registrosFiltrados: CotizacionPayload[] = [];
  actos: TarifarioActo[] = [];
  searchTerm: string = '';
  paginaActual: number = 1;
  itemsPorPagina: number = 5;
  
  offsetActual: number = 0;
  limitePorBloque: number = 100;
  hayMasEnNube: boolean = false;
  cargandoMas: boolean = false;

  constructor(
    private apiSvc: ApiService, 
    private pdfSvc: PdfService,
    private datePipe: DatePipe
  ) {}

  ngOnInit() {
    this.cargarDatos();
  }

  async cargarDatos() {
    try {
      const [actos, res] = await Promise.all([
        this.apiSvc.getTarifarioActos(),
        this.apiSvc.getHistorial(this.limitePorBloque, this.offsetActual)
      ]);
      this.actos = actos;
      this.registros = [...res.data].reverse(); // Mostrar los más recientes primero
      this.hayMasEnNube = res.hasMore;
      this.aplicarFiltro();
    } catch (e) {
      console.error('Error cargando historial', e);
    }
  }

  aplicarFiltro(resetPagina: boolean = true) {
    if (!this.searchTerm) {
      this.registrosFiltrados = [...this.registros];
    } else {
      const term = this.searchTerm.toLowerCase();
      this.registrosFiltrados = this.registros.filter(r => 
        (r.referenciaInterna || '').toLowerCase().includes(term) ||
        r.tipoActo.toLowerCase().includes(term)
      );
    }
    if (resetPagina) {
      this.paginaActual = 1;
    }
  }

  get paginatedRegistros() {
    const inicio = (this.paginaActual - 1) * this.itemsPorPagina;
    return this.registrosFiltrados.slice(inicio, inicio + this.itemsPorPagina);
  }

  get totalPaginas() {
    return Math.ceil(this.registrosFiltrados.length / this.itemsPorPagina) || 1;
  }

  async cambiarPagina(delta: number) {
    const nuevaPagina = this.paginaActual + delta;
    
    if (nuevaPagina > this.totalPaginas && this.hayMasEnNube && !this.cargandoMas) {
       this.cargandoMas = true;
       this.offsetActual += this.limitePorBloque;
       try {
         const res = await this.apiSvc.getHistorial(this.limitePorBloque, this.offsetActual);
         this.registros = [...this.registros, ...res.data.reverse()];
         this.hayMasEnNube = res.hasMore;
         this.aplicarFiltro(false);
         this.paginaActual = nuevaPagina;
       } catch (e) {
         console.error('Error cargando más historial', e);
       } finally {
         this.cargandoMas = false;
       }
       return;
    }

    if (nuevaPagina >= 1 && nuevaPagina <= this.totalPaginas) {
      this.paginaActual = nuevaPagina;
    }
  }

  regenerarPdf(registro: CotizacionPayload, conRequisitos: boolean) {
    const nombresActos = registro.tipoActo.split(' + ');
    const items: CotizacionItem[] = [];

    for (const nombre of nombresActos) {
      const acto = this.actos.find(a => a.nombre === nombre.trim());
      if (acto) {
        items.push({
          id: Date.now().toString(),
          acto: acto,
          moneda: registro.moneda as 'DOLARES'|'SOLES',
          cantidadInmuebles: registro.cantidadInmuebles,
          conoceValores: false,
          importeAgrupado: 0,
          importesIndividuales: [],
          referencia: registro.referenciaInterna,
          costoNotarialFinal: items.length === 0 ? registro.costoNotarial : 0,
          costoRegistralFinal: items.length === 0 ? registro.costoRegistral : 0,
          totalFinal: items.length === 0 ? registro.totalPagar : 0
        });
      }
    }
    
    if (items.length === 0) {
      items.push({
        id: Date.now().toString(),
        acto: { id: 'GENERIC', nombre: registro.tipoActo, costo_tramite: 0, tasa_registral_por_mil: 0, rangos: [], requisitos: [] },
        moneda: registro.moneda as 'DOLARES'|'SOLES',
        cantidadInmuebles: registro.cantidadInmuebles,
        conoceValores: false,
        importeAgrupado: 0,
        importesIndividuales: [],
        referencia: registro.referenciaInterna,
        costoNotarialFinal: registro.costoNotarial,
        costoRegistralFinal: registro.costoRegistral,
        totalFinal: registro.totalPagar
      });
    }

    const fechaObj = new Date(registro.fecha);
    const fechaFormateadaLetras = obtenerFechaFormateadaLetras(fechaObj);

    this.pdfSvc.generarPdfMulti(items, fechaFormateadaLetras, conRequisitos, fechaObj, registro.referenciaInterna);
  }
}
