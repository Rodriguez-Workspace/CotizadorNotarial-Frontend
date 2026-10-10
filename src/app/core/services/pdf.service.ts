import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import Swal from 'sweetalert2';
import { environment } from '../../../environments/environment';
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

      const rawHexMembrete = ctx?.perfil.color_membrete?.trim() || '#002855';
      const hexColorMembrete = rawHexMembrete.startsWith('#') ? rawHexMembrete : `#${rawHexMembrete}`;
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

      // Determinar título principal según la(s) categoría(s) de los actos
      const categoriasSet = new Set<string>();
      items.forEach(it => {
        const catNom = it.acto.categoria_nombre?.trim();
        if (catNom) {
          categoriasSet.add(catNom);
        }
      });
      const categoriasList = Array.from(categoriasSet);
      let tituloPrincipal = 'COTIZACIÓN DE ESCRITURA PÚBLICA';
      if (categoriasList.length > 0) {
        const formatCat = (c: string) => {
          const upper = c.trim().toUpperCase();
          return upper.startsWith('DE ') ? upper.substring(3).trim() : upper;
        };
        const catsTexto = categoriasList.map(formatCat).join(' Y ');
        tituloPrincipal = `COTIZACIÓN DE ${catsTexto}`;
      }

      // 1. Todas las bases primero (sin duplicados, en orden de aparición de los actos)
      const basesMap = new Map<string, string>();
      // 2. Después los específicos de cada acto (sin duplicados)
      const especificosMap = new Map<string, string>();

      items.forEach(it => {
        if (it.acto.requisitos && Array.isArray(it.acto.requisitos)) {
          it.acto.requisitos.forEach(req => {
            if (req.is_base) {
              if (!basesMap.has(req.id)) {
                basesMap.set(req.id, req.texto);
              }
            } else {
              if (!especificosMap.has(req.id)) {
                especificosMap.set(req.id, req.texto);
              }
            }
          });
        }
      });

      // Deduplicar: si un específico ya está en las bases, no se duplica
      const listaFinalBases = Array.from(basesMap.values());
      const listaFinalEspecificos: string[] = [];
      for (const [id, texto] of especificosMap.entries()) {
        if (!basesMap.has(id)) {
          listaFinalEspecificos.push(texto);
        }
      }

      const requisitosDeduplicados = [...listaFinalBases, ...listaFinalEspecificos];

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
          const maxW = 18.5, maxH = 18;
          const ratio = imgIzq.width / imgIzq.height;
          const boxRatio = maxW / maxH;
          let w = maxW, h = maxH;
          if (ratio >= boxRatio) {
            h = maxW / ratio;
          } else {
            w = maxH * ratio;
          }
          const x = 27 + (maxW - w) / 2;
          const y = 9.3 + (maxH - h) / 2;
          doc.addImage(imgIzq.dataUrl, this.getImageFormat(imgIzq.dataUrl), x, y, w, h);
        }

        if (imgCentro) {
          const maxW = 76, maxH = 17.5;
          const ratio = imgCentro.width / imgCentro.height;
          const boxRatio = maxW / maxH;
          let w = maxW, h = maxH;
          if (ratio >= boxRatio) {
            h = maxW / ratio;
          } else {
            w = maxH * ratio;
          }
          const x = 105 - (w / 2);
          const y = 8.0 + (maxH - h) / 2;
          doc.addImage(imgCentro.dataUrl, this.getImageFormat(imgCentro.dataUrl), x, y, w, h);
        }

        if (imgDer) {
          const maxW = 20.5, maxH = 21.8;
          const ratio = imgDer.width / imgDer.height;
          const boxRatio = maxW / maxH;
          let w = maxW, h = maxH;
          if (ratio >= boxRatio) {
            h = maxW / ratio;
          } else {
            w = maxH * ratio;
          }
          const x = 160 + (maxW - w) / 2;
          const y = 6.5 + (maxH - h) / 2;
          doc.addImage(imgDer.dataUrl, this.getImageFormat(imgDer.dataUrl), x, y, w, h);
        }

        // Línea divisoria superior de borde a borde (0 a 210mm) con el color del membrete
        doc.setDrawColor(rM, gM, bM);
        doc.setLineWidth(0.6);
        doc.line(0, 32.5, 210, 32.5);

        // RESTAURAR INMEDIATAMENTE EL ESTADO GRÁFICO PARA EL CUERPO (color negro y grosor normal)
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.2);
        doc.setTextColor(0, 0, 0);

        doc.setFont("helvetica", "bold");
        const titleFontSizeWithHeader = doc.getTextWidth(tituloPrincipal) > 170 ? 9.5 : 11;
        doc.setFontSize(titleFontSizeWithHeader);
        doc.text(tituloPrincipal, 105, 41, { align: "center" });
      } else {
        doc.setTextColor(r, g, b);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(nombreNotaria.toUpperCase(), 105, 20, { align: "center" });

        // RESTAURAR ESTADO GRÁFICO PARA EL CUERPO
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.2);
        doc.setTextColor(0, 0, 0);

        doc.setFont("helvetica", "bold");
        const titleFontSizeNoHeader = doc.getTextWidth(tituloPrincipal) > 170 ? 9.5 : 11;
        doc.setFontSize(titleFontSizeNoHeader);
        doc.text(tituloPrincipal, 105, 30, { align: "center" });
      }

      // ─── Cuerpo del Documento (Intacto) ───────────────────────────
      if (referencia) {
        doc.setFontSize(9);
        doc.text(`REF: ${referencia.toUpperCase()}`, 20, 50);
      }

      doc.setFontSize(9);
      const actoTextoCompleto = this.construirLineaDescriptivaActos(items);
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
        doc.setLineWidth(0.4);
        doc.line(0, 278.8, 210, 278.8);

        // Restaurar drawColor y lineWidth
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.2);

        if (direccion || distritoCiudad) {
          const pinDataUrl = await this.getPinIcon(hexColorMembrete);
          if (pinDataUrl) {
            doc.addImage(pinDataUrl, 'PNG', 7.5, 282.0, 4.1, 4.8);
          }

          doc.setFont("times", "normal");
          doc.setFontSize(12.5);
          doc.setTextColor(rM, gM, bM);

          const textX = pinDataUrl ? 13.0 : 7.5;
          if (direccion) {
            doc.text(direccion, textX, 285.8);
          }
          if (distritoCiudad) {
            doc.text(distritoCiudad, textX, direccion ? 290.5 : 285.8);
          }
        }

        if (telefono) {
          const phoneDataUrl = await this.getPhoneIcon(hexColorMembrete);
          const telClean = telefono.startsWith(':') ? telefono.substring(1).trim() : telefono;
          const txtTel = `: ${telClean}`;
          doc.setFont("times", "normal");
          doc.setFontSize(12.5);
          doc.setTextColor(rM, gM, bM);

          const txtWidth = doc.getTextWidth(txtTel);
          const iconW = 5.0;
          const gap = 1.0;
          const totalW = (phoneDataUrl ? iconW + gap : 0) + txtWidth;
          const startX = 199.0 - totalW;

          if (phoneDataUrl) {
            doc.addImage(phoneDataUrl, 'PNG', startX, 281.6, iconW, iconW);
          }
          doc.text(txtTel, startX + (phoneDataUrl ? iconW + gap : 0), 285.8);
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

    // 1. Intento a través del proxy del Backend Worker (elimina cualquier bloqueo CORS del bucket)
    try {
      const proxyUrl = `${environment.apiUrl}/api/image-proxy?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const blob = await res.blob();
        const entry = await this.blobToDataUrl(blob);
        if (entry) {
          this.imageCache.set(url, entry);
          return entry;
        }
      }
    } catch {
      // Fallback
    }

    // 2. Intento de descarga directa
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        const entry = await this.blobToDataUrl(blob);
        if (entry) {
          this.imageCache.set(url, entry);
          return entry;
        }
      }
    } catch {
      // Fallback
    }

    // 3. Intento vía HTMLImageElement con canvas
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

  private blobToDataUrl(blob: Blob): Promise<{ dataUrl: string; width: number; height: number } | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          resolve({
            dataUrl,
            width: img.naturalWidth,
            height: img.naturalHeight
          });
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  private getImageFormat(dataUrl: string): string {
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
      return 'JPEG';
    }
    if (dataUrl.startsWith('data:image/webp')) {
      return 'WEBP';
    }
    return 'PNG';
  }

  private async getPinIcon(hexColor: string): Promise<string> {
    const validHex = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
    if (this.pinIconCache.has(validHex)) return this.pinIconCache.get(validHex)!;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 28"><path fill="${validHex}" d="M12 1.5C7.3 1.5 3.5 5.3 3.5 10c0 6.2 8.5 16.5 8.5 16.5s8.5-10.3 8.5-16.5c0-4.7-3.8-8.5-8.5-8.5zm0 12.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>`;
    const dataUrl = await this.svgToDataUrl(svg, 120, 140);
    this.pinIconCache.set(validHex, dataUrl);
    return dataUrl;
  }

  private async getPhoneIcon(hexColor: string): Promise<string> {
    const validHex = hexColor.startsWith('#') ? hexColor : `#${hexColor}`;
    if (this.phoneIconCache.has(validHex)) return this.phoneIconCache.get(validHex)!;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${validHex}" d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2z"/><path fill="#ffffff" d="M17.52 14.33c-.29-.14-1.74-.86-2.01-.96-.27-.1-.47-.14-.67.14-.2.29-.77.96-.94 1.16-.17.2-.34.22-.63.08-.29-.14-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.59.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.2.05-.37-.02-.51-.08-.14-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.29-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.09 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.74-.71 1.98-1.4.24-.69.24-1.28.17-1.4-.07-.12-.27-.19-.56-.33z"/></svg>`;
    const dataUrl = await this.svgToDataUrl(svg, 128, 128);
    this.phoneIconCache.set(validHex, dataUrl);
    return dataUrl;
  }

  private svgToDataUrl(svgString: string, width = 128, height = 128): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
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

  private singularizarFrase(frase: string): string {
    return frase.trim().split(/\s+/).map(palabra => {
      const w = palabra.toUpperCase();
      if (['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'EN', 'POR', 'Y', 'O', 'NO', 'PARA', 'CON'].includes(w)) return w;
      if (w.endsWith('CES') && w.length > 4) return w.slice(0, -3) + 'Z';
      if (w.endsWith('ES') && w.length > 3) {
        if (w.endsWith('CIONES')) return w.slice(0, -6) + 'CIÓN';
        if (w.endsWith('SIONES')) return w.slice(0, -6) + 'SIÓN';
        if (w.endsWith('LES')) return w.slice(0, -2);
        if (w.endsWith('RES')) return w.slice(0, -2);
        if (w.endsWith('NES')) return w.slice(0, -2);
        if (w.endsWith('DES')) return w.slice(0, -2);
      }
      if (w.endsWith('AS') && w.length > 3) return w.slice(0, -1);
      if (w.endsWith('OS') && w.length > 3) return w.slice(0, -1);
      if (w.endsWith('S') && !w.endsWith('IS') && !w.endsWith('US') && w.length > 3) return w.slice(0, -1);
      return w;
    }).join(' ');
  }

  private unirConY(elementos: string[]): string {
    if (elementos.length === 0) return '';
    if (elementos.length === 1) return elementos[0];
    if (elementos.length === 2) return `${elementos[0]} Y ${elementos[1]}`;
    return `${elementos.slice(0, -1).join(', ')} Y ${elementos[elementos.length - 1]}`;
  }

  private formatearGrupoCategoria(catNombre: string, actosNombres: string[]): string {
    const rawUpper = catNombre.trim().toUpperCase();
    const catLimpia = rawUpper.startsWith('DE ') ? rawUpper.substring(3).trim() : rawUpper;
    const catSingular = this.singularizarFrase(catLimpia);

    const conectores = ['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'EN', 'POR', 'PARA', 'CON', 'SIN', 'SOBRE', 'Y', 'O', 'NO'];
    const palabrasClaveCat = catSingular
      .split(/\s+/)
      .map(p => p.trim())
      .filter(p => p.length >= 4 && !conectores.includes(p));

    const esContenedorGenerico = ['ASUNTO', 'TRAMITE', 'TRÁMITE', 'PROCESO', 'DILIGENCIA', 'OTRO', 'VARIOS'].some(c =>
      rawUpper.includes(c)
    );

    const prefixDe = `${catSingular} DE `;

    const actosLimpios = actosNombres.map(a => {
      let t = a.trim().toUpperCase();
      if (t.startsWith(prefixDe)) {
        t = t.substring(prefixDe.length).trim();
      }
      return t;
    });

    const algunActoTieneClave = palabrasClaveCat.some(clave =>
      actosLimpios.some(acto => acto.includes(clave))
    );

    if (esContenedorGenerico || algunActoTieneClave) {
      return this.unirConY(actosLimpios);
    }

    return `${catSingular} DE ${this.unirConY(actosLimpios)}`;
  }

  private construirLineaDescriptivaActos(items: CotizacionItem[]): string {
    const gruposMap = new Map<string, string[]>();
    items.forEach(it => {
      const cat = it.acto.categoria_nombre?.trim() || 'Escrituras Públicas';
      if (!gruposMap.has(cat)) {
        gruposMap.set(cat, []);
      }
      gruposMap.get(cat)!.push(it.acto.nombre.trim());
    });

    const fragmentosGrupos: string[] = [];
    for (const [catNombre, actosNombres] of gruposMap.entries()) {
      fragmentosGrupos.push(this.formatearGrupoCategoria(catNombre, actosNombres));
    }

    return `1.- ${fragmentosGrupos.join(' / ')}`;
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
