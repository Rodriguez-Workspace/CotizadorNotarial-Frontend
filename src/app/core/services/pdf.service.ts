import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import Swal from 'sweetalert2';
import { AuthService } from './auth.service';
import { CotizacionItem } from './calculator.service';

@Injectable({
  providedIn: 'root'
})
export class PdfService {
  private auth = inject(AuthService);

  constructor() { }

  private imageCache = new Map<string, { dataUrl: string; width: number; height: number }>();
  private pinIconCache = new Map<string, string>();
  private phoneIconCache = new Map<string, string>();

  async generarPdfMulti(
    items: CotizacionItem[], 
    fechaString: string, 
    incluirRequisitos: boolean,
    fechaObj: Date,
    referencia?: string
  ): Promise<void> {
    if (!items || items.length === 0) return;

    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      
      const ctx = this.auth.currentContext;
      const nombreNotaria = ctx?.perfil.nombre_oficial || 'COTIZADOR NOTARIAL';
      const hexColor = ctx?.perfil.color_marca || '#125B18';

      let r = 0, g = 0, b = 0;
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor);
      if (result) {
        r = parseInt(result[1], 16);
        g = parseInt(result[2], 16);
        b = parseInt(result[3], 16);
      }

      const hexColorMembrete = ctx?.perfil.color_membrete?.trim() || '#002855';
      let rM = 0, gM = 40, bM = 85;
      const resultM = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColorMembrete);
      if (resultM) {
        rM = parseInt(resultM[1], 16);
        gM = parseInt(resultM[2], 16);
        bM = parseInt(resultM[3], 16);
      }
      
      const numFormat = (num: number) => num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      const granTotalNotarial = items.reduce((sum, it) => sum + it.costoNotarialFinal, 0);
      const granTotalRegistral = items.reduce((sum, it) => sum + it.costoRegistralFinal, 0);
      const granTotalPagar = items.reduce((sum, it) => sum + it.totalFinal, 0);

      const nombresActos = items.map(it => it.acto.nombre).join(', ');

      const reqsMap = new Map<string, string>();
      items.forEach(it => {
        if (it.acto.requisitos && Array.isArray(it.acto.requisitos)) {
          it.acto.requisitos.forEach(req => {
            reqsMap.set(req.id, req.texto);
          });
        }
      });
      const requisitosDeduplicados = Array.from(reqsMap.values());

      // ─── Membrete Superior Condicional ────────────────────────────
      const tieneMembreteSuperior = Boolean(
        ctx?.perfil.membrete_izquierdo_url || 
        ctx?.perfil.membrete_centro_url || 
        ctx?.perfil.membrete_derecho_url
      );

      if (tieneMembreteSuperior) {
        const [imgIzq, imgCentro, imgDer] = await Promise.all([
          ctx?.perfil.membrete_izquierdo_url ? this.loadImageDataUrl(ctx.perfil.membrete_izquierdo_url) : Promise.resolve(null),
          ctx?.perfil.membrete_centro_url ? this.loadImageDataUrl(ctx.perfil.membrete_centro_url) : Promise.resolve(null),
          ctx?.perfil.membrete_derecho_url ? this.loadImageDataUrl(ctx.perfil.membrete_derecho_url) : Promise.resolve(null)
        ]);

        if (imgIzq) {
          const maxW = 28, maxH = 22;
          const ratio = imgIzq.width / imgIzq.height;
          let w = maxW, h = maxH;
          if (ratio >= 1) {
            h = Math.min(maxH, w / ratio);
          } else {
            w = Math.min(maxW, h * ratio);
          }
          const y = 9 + (maxH - h) / 2;
          doc.addImage(imgIzq.dataUrl, 'PNG', 15, y, w, h);
        }

        if (imgCentro) {
          const maxW = 100, maxH = 22;
          const ratio = imgCentro.width / imgCentro.height;
          let w = maxW, h = maxH;
          if (ratio > (maxW / maxH)) {
            h = w / ratio;
          } else {
            w = h * ratio;
          }
          const x = 105 - (w / 2);
          const y = 9 + (maxH - h) / 2;
          doc.addImage(imgCentro.dataUrl, 'PNG', x, y, w, h);
        }

        if (imgDer) {
          const maxW = 28, maxH = 22;
          const ratio = imgDer.width / imgDer.height;
          let w = maxW, h = maxH;
          if (ratio >= 1) {
            h = Math.min(maxH, w / ratio);
          } else {
            w = Math.min(maxW, h * ratio);
          }
          const x = 195 - w;
          const y = 9 + (maxH - h) / 2;
          doc.addImage(imgDer.dataUrl, 'PNG', x, y, w, h);
        }

        // Línea divisoria superior de borde a borde (0 a 210mm) con el color del membrete
        doc.setDrawColor(rM, gM, bM);
        doc.setLineWidth(0.8);
        doc.line(0, 33, 210, 33);

        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("COTIZACIÓN DE ESCRITURA PÚBLICA", 105, 41, { align: "center" });
      } else {
        doc.setTextColor(r, g, b);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(nombreNotaria.toUpperCase(), 105, 20, { align: "center" });

        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("COTIZACIÓN DE ESCRITURA PÚBLICA", 105, 30, { align: "center" });
      }

      // ─── Cuerpo del Documento (Intacto) ───────────────────────────
      if (referencia) {
        doc.setFontSize(9);
        doc.text(`REF: ${referencia.toUpperCase()}`, 20, 50);
      }

      doc.setFontSize(9);
      const actoTextoCompleto = `1.- ESCRITURA PÚBLICA DE ${nombresActos.toUpperCase()}`;
      const lineasActo = doc.splitTextToSize(actoTextoCompleto, 170);
      doc.text(lineasActo, 20, 70);

      const offsetLineas = (lineasActo.length - 1) * 5;
      
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

      let yPos = 140 + offsetLineas;
      if (incluirRequisitos) {
        doc.text("REQUISITOS*:", 20, yPos);
        doc.line(20, yPos + 1, 46, yPos + 1);
        
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
        
        yPos += 2;
        doc.setFont("helvetica", "bolditalic");
        doc.text("*Requisitos sujetos a evaluación", 20, yPos);
        yPos += 5;
      }

      doc.setFont("helvetica", "bold");
      doc.text(fechaString.toUpperCase() + " (VÁLIDO POR 90 DÍAS)", 20, yPos + 15);

      // ─── Membrete Inferior Condicional (Pie de Página) ───────────
      const direccion = ctx?.perfil.direccion?.trim();
      const distritoCiudad = ctx?.perfil.distrito_ciudad?.trim();
      const telefono = ctx?.perfil.telefono_contacto?.trim();

      const tieneMembreteInferior = Boolean(direccion || distritoCiudad || telefono);

      if (tieneMembreteInferior) {
        // Línea divisoria inferior de borde a borde (0 a 210mm) con el color del membrete
        doc.setDrawColor(rM, gM, bM);
        doc.setLineWidth(0.8);
        doc.line(0, 276, 210, 276);

        if (direccion || distritoCiudad) {
          const pinDataUrl = await this.getPinIcon(hexColorMembrete);
          if (pinDataUrl) {
            doc.addImage(pinDataUrl, 'PNG', 15, 279, 3.8, 3.8);
          }

          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.5);
          doc.setTextColor(rM, gM, bM);

          if (direccion) {
            doc.text(direccion, pinDataUrl ? 20 : 15, 282.5);
          }
          if (distritoCiudad) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(rM, gM, bM);
            doc.text(distritoCiudad, pinDataUrl ? 20 : 15, direccion ? 286.5 : 282.5);
          }
        }

        if (telefono) {
          const phoneDataUrl = await this.getPhoneIcon(hexColorMembrete);
          const txtTel = `: ${telefono}`;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.5);
          doc.setTextColor(rM, gM, bM);

          const txtWidth = doc.getTextWidth(txtTel);
          const iconW = 3.8;
          const gap = 1;
          const totalW = (phoneDataUrl ? iconW + gap : 0) + txtWidth;
          const startX = 195 - totalW;

          if (phoneDataUrl) {
            doc.addImage(phoneDataUrl, 'PNG', startX, 279.5, iconW, iconW);
          }
          doc.text(txtTel, startX + (phoneDataUrl ? iconW + gap : 0), 282.5);
        }
      }

      const hh = String(fechaObj.getHours()).padStart(2, '0');
      const min = String(fechaObj.getMinutes()).padStart(2, '0');
      const horaCorta = `${hh}h${min}`;
      
      const dd = String(fechaObj.getDate()).padStart(2, '0');
      const mm = String(fechaObj.getMonth() + 1).padStart(2, '0');
      const yyyy = fechaObj.getFullYear();
      const fechaCorta = `${dd}-${mm}-${yyyy}`;
      
      const refBase = referencia ? this.sanitizarNombreArchivo(referencia) : 'Cotizacion';
      const sufijoReq = incluirRequisitos ? '+req' : '';

      const nombreArchivo = `${refBase}${sufijoReq}-${fechaCorta}-${horaCorta}.pdf`;

      doc.save(nombreArchivo);
      
    } catch (e: any) {
      console.error('Error al generar PDF nativo:', e);
      Swal.fire('Error en PDF', 'Detalle técnico para el desarrollador: ' + (e.message || e.toString()), 'error');
    }
  }

  private async loadImageDataUrl(url: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
    if (!url) return null;
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url)!;
    }

    try {
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = reject;
          img.src = dataUrl;
        });

        const entry = { dataUrl, ...dimensions };
        this.imageCache.set(url, entry);
        return entry;
      }
    } catch {
      // Intento alternativo con Image y Canvas
    }

    try {
      const entry = await new Promise<{ dataUrl: string; width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas context unavailable'));
            ctx.drawImage(img, 0, 0);
            resolve({
              dataUrl: canvas.toDataURL('image/png'),
              width: img.naturalWidth,
              height: img.naturalHeight
            });
          } catch (canvasErr) {
            reject(canvasErr);
          }
        };
        img.onerror = reject;
        img.src = url;
      });

      this.imageCache.set(url, entry);
      return entry;
    } catch (err) {
      console.warn('No se pudo cargar la imagen del membrete:', url, err);
      return null;
    }
  }

  private async getPinIcon(hexColor: string): Promise<string> {
    if (this.pinIconCache.has(hexColor)) return this.pinIconCache.get(hexColor)!;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${hexColor}"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/></svg>`;
    const dataUrl = await this.svgToDataUrl(svg);
    this.pinIconCache.set(hexColor, dataUrl);
    return dataUrl;
  }

  private async getPhoneIcon(hexColor: string): Promise<string> {
    if (this.phoneIconCache.has(hexColor)) return this.phoneIconCache.get(hexColor)!;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${hexColor}"/><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="#ffffff"/></svg>`;
    const dataUrl = await this.svgToDataUrl(svg);
    this.phoneIconCache.set(hexColor, dataUrl);
    return dataUrl;
  }

  private svgToDataUrl(svgString: string, size = 64): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve('');
        }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve('');
      };
      img.src = url;
    });
  }

  private sanitizarNombreArchivo(nombre: string): string {
    let sanitizado = nombre.replace(/\//g, '_');
    sanitizado = sanitizado.replace(/[\\:*?"<>|]/g, '');
    sanitizado = sanitizado.replace(/\s+/g, '_');
    sanitizado = sanitizado.trim().replace(/^\.+|\.+$/g, '');
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reserved.test(sanitizado)) {
      sanitizado = sanitizado + '_';
    }
    
    return sanitizado || 'Cotizacion';
  }
}
