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
    const value = this.control.value;
    if (value !== null && value !== undefined) {
      this.formatAndSetValue(String(value));
    }

    this.control.valueChanges?.subscribe(val => {
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

    let cleanStr = String(value).replace(/[^0-9.]/g, '');
    
    const parts = cleanStr.split('.');
    if (parts.length > 1) {
      const decimalPart = parts[1].substring(0, 2);
      cleanStr = parts[0] + '.' + decimalPart;
    }

    const formattedStr = this.addCommas(cleanStr);
    this.el.nativeElement.value = formattedStr;

    const numericValue = parseFloat(cleanStr);
    
    if (!isNaN(numericValue)) {
      this.control.control?.setValue(numericValue, { emitEvent: true, emitModelToViewChange: false });
    } else {
      this.control.control?.setValue(null, { emitEvent: true, emitModelToViewChange: false });
    }
  }

  private addCommas(value: string): string {
    const parts = value.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
}
