import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import Swal from 'sweetalert2';
import { AuthService } from './auth.service';
import { CotizacionItem, Requisito } from './calculator.service';

@Injectable({
  providedIn: 'root'
})
export class PdfService {
  private auth = inject(AuthService);

  constructor() { }

  generarPdfMulti(
    items: CotizacionItem[], 
    fechaString: string, 
    incluirRequisitos: boolean,
    fechaObj: Date,
    referencia?: string
  ) {
    if (!items || items.length === 0) return;

    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      
      const ctx = this.auth.currentContext;
      const nombreNotaria = ctx?.perfil.nombre_oficial || 'COTIZADOR NOTARIAL';
      const hexColor = ctx?.perfil.color_marca || '#125B18';

      // Parse hex color for jsPDF
      let r = 0, g = 0, b = 0;
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor);
      if (result) {
        r = parseInt(result[1], 16);
        g = parseInt(result[2], 16);
        b = parseInt(result[3], 16);
      }
      
      const numFormat = (num: number) => num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      // Totales
      const granTotalNotarial = items.reduce((sum, it) => sum + it.costoNotarialFinal, 0);
      const granTotalRegistral = items.reduce((sum, it) => sum + it.costoRegistralFinal, 0);
      const granTotalPagar = items.reduce((sum, it) => sum + it.totalFinal, 0);

      // Concatenación de Actos
      const nombresActos = items.map(it => it.acto.nombre).join(', ');

      // Deduplicación de Requisitos por ID
      const reqsMap = new Map<string, string>();
      items.forEach(it => {
        if (it.acto.requisitos && Array.isArray(it.acto.requisitos)) {
          it.acto.requisitos.forEach(req => {
            reqsMap.set(req.id, req.texto);
          });
        }
      });
      const requisitosDeduplicados = Array.from(reqsMap.values());

      // Título con el color de la notaría
      doc.setTextColor(r, g, b);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(nombreNotaria.toUpperCase(), 105, 20, { align: "center" });

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      doc.text("COTIZACIÓN DE ESCRITURA PÚBLICA", 105, 30, { align: "center" });

      // Referencia
      if (referencia) {
        doc.setFontSize(9);
        doc.text(`REF: ${referencia.toUpperCase()}`, 20, 50);
      }

      // Acto (Múltiples)
      doc.setFontSize(9);
      const actoTextoCompleto = `1.- ESCRITURA PÚBLICA DE ${nombresActos.toUpperCase()}`;
      const lineasActo = doc.splitTextToSize(actoTextoCompleto, 170);
      doc.text(lineasActo, 20, 70);

      const offsetLineas = (lineasActo.length - 1) * 5;
      
      // Costos Consolidados
      doc.setFont("helvetica", "normal");
      
      doc.text("DERECHO NOTARIAL", 20, 90 + offsetLineas);
      doc.text(":", 80, 90 + offsetLineas);
      doc.text(`S/.  ${numFormat(granTotalNotarial)}`, 90, 90 + offsetLineas);

      doc.text("DERECHO REGISTRAL (APROX.)", 20, 100 + offsetLineas);
      doc.text(":", 80, 100 + offsetLineas);
      
      const txtReg = `S/.  ${numFormat(granTotalRegistral)}`;
      doc.text(txtReg, 90, 100 + offsetLineas);
      doc.line(90, 101 + offsetLineas, 112, 101 + offsetLineas);

      doc.setFont("helvetica", "bold");
      doc.text("TOTAL:", 60, 115 + offsetLineas);
      doc.text(`S/.  ${numFormat(granTotalPagar)}`, 90, 115 + offsetLineas);

      // Requisitos
      let yPos = 140 + offsetLineas;
      if (incluirRequisitos) {
        doc.text("REQUISITOS:", 20, yPos);
        doc.line(20, yPos + 1, 44, yPos + 1);
        
        doc.setFont("helvetica", "normal");
        yPos += 15;
        
        if (requisitosDeduplicados.length > 0) {
          for (const txt of requisitosDeduplicados) {
            const lines = doc.splitTextToSize(`- ${txt.toUpperCase()}`, 170);
            doc.text(lines, 20, yPos);
            yPos += (lines.length * 7);
          }
        } else {
          doc.text("- SIN REQUISITOS ADICIONALES", 20, yPos);
          yPos += 7;
        }
      }

      // Fecha al final
      doc.setFont("helvetica", "bold");
      doc.text(fechaString.toUpperCase(), 20, yPos + 15);

      // Formatear la hora en formato HHhMM
      const hh = String(fechaObj.getHours()).padStart(2, '0');
      const min = String(fechaObj.getMinutes()).padStart(2, '0');
      const horaCorta = `${hh}h${min}`;
      
      // Formatear la fecha
      const dd = String(fechaObj.getDate()).padStart(2, '0');
      const mm = String(fechaObj.getMonth() + 1).padStart(2, '0');
      const yyyy = fechaObj.getFullYear();
      const fechaCorta = `${dd}-${mm}-${yyyy}`;
      
      // Determinar la referencia y el sufijo
      const refBase = referencia ? this.sanitizarNombreArchivo(referencia) : 'Cotizacion';
      const sufijoReq = incluirRequisitos ? '+req' : '';

      const nombreArchivo = `${refBase}${sufijoReq}-${fechaCorta}-${horaCorta}.pdf`;

      doc.save(nombreArchivo);
      
    } catch (e: any) {
      console.error('Error al generar PDF nativo:', e);
      Swal.fire('Error en PDF', 'Detalle técnico para el desarrollador: ' + (e.message || e.toString()), 'error');
    }
  }

  private sanitizarNombreArchivo(nombre: string): string {
    // 1. Reemplazar / con _
    let sanitizado = nombre.replace(/\//g, '_');
    // 2. Eliminar caracteres inválidos por si acaso \ : * ? " < > |
    sanitizado = sanitizado.replace(/[\\:*?"<>|]/g, '');
    // 3. Reemplazar espacios por _
    sanitizado = sanitizado.replace(/\s+/g, '_');
    // 4. Eliminar puntos iniciales y finales
    sanitizado = sanitizado.trim().replace(/^\.+|\.+$/g, '');
    // 5. Revisar nombres reservados de Windows
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reserved.test(sanitizado)) {
      sanitizado = sanitizado + '_';
    }
    
    return sanitizado || 'Cotizacion';
  }
}
