import { Directive, ElementRef, HostListener, OnInit } from '@angular/core';
import { NgControl } from '@angular/forms';

@Directive({
  selector: '[appCurrencyFormat]',
  standalone: true
})
export class CurrencyFormatDirective implements OnInit {
  private isFocused = false;

  constructor(private el: ElementRef<HTMLInputElement>, private control: NgControl) {}

  @HostListener('focus') onFocus() { this.isFocused = true; }
  @HostListener('blur') onBlur() { this.isFocused = false; }

  ngOnInit() {
    // Si hay un valor inicial pre-cargado, lo formateamos
    const value = this.control.value;
    if (value !== null && value !== undefined) {
      this.formatAndSetValue(String(value));
    }

    // Escuchamos cambios desde el modelo (ej. form.reset())
    this.control.valueChanges?.subscribe(val => {
      // Si el usuario está escribiendo activamente, NO sobrescribimos su texto
      // para evitar que se borre el punto decimal o los ceros a la derecha.
      if (this.isFocused) return;

      if (val === null || val === undefined) {
        if (this.el.nativeElement.value !== '') {
           this.el.nativeElement.value = '';
        }
      } else if (typeof val === 'number') {
         const expectedStr = this.addCommas(String(val));
         if (this.el.nativeElement.value !== expectedStr && this.el.nativeElement.value.replace(/,/g, '') !== String(val)) {
             this.el.nativeElement.value = expectedStr;
         }
      }
    });
  }

  @HostListener('input', ['$event.target.value'])
  onInput(value: string) {
    this.formatAndSetValue(value);
  }

  private formatAndSetValue(value: string) {
    if (value === null || value === undefined || value === '') {
      this.control.control?.setValue(null, { emitEvent: true, emitModelToViewChange: false });
      this.el.nativeElement.value = '';
      return;
    }

    // 1. Quitar letras y dejar solo números y un punto decimal
    let cleanStr = String(value).replace(/[^0-9.]/g, '');
    
    // Prevenir múltiples puntos decimales y limitar a 2 decimales
    const parts = cleanStr.split('.');
    if (parts.length > 1) {
      // Tomar el primer segmento decimal y cortarlo a un máximo de 2 caracteres
      const decimalPart = parts[1].substring(0, 2);
      cleanStr = parts[0] + '.' + decimalPart;
    }

    // 2. Formatear visualmente con comas
    const formattedStr = this.addCommas(cleanStr);

    // 3. Escribir en el cuadro de texto (DOM)
    this.el.nativeElement.value = formattedStr;

    // 4. Escribir el número puro en el sistema de Angular para las matemáticas
    const numericValue = parseFloat(cleanStr);
    
    if (!isNaN(numericValue)) {
      this.control.control?.setValue(numericValue, { emitEvent: true, emitModelToViewChange: false });
    } else {
      this.control.control?.setValue(null, { emitEvent: true, emitModelToViewChange: false });
    }
  }

  private addCommas(value: string): string {
    const parts = value.split('.');
    // Agrega comas cada 3 dígitos en la parte entera
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
}
