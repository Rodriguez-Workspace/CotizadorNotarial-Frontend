import { Component, Input, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-switcher',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './switcher.component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SwitcherComponent),
      multi: true
    }
  ]
})
export class SwitcherComponent implements ControlValueAccessor {
  @Input() option1: string = 'Opción 1';
  @Input() option2: string = 'Opción 2';
  @Input() value1: any = '1';
  @Input() value2: any = '2';
  selectedValue: any;

  onChange = (value: any) => {};
  onTouched = () => {};

  selectOption(val: any) {
    this.selectedValue = val;
    this.onChange(val);
    this.onTouched();
  }

  writeValue(obj: any): void {
    this.selectedValue = obj;
  }
  registerOnChange(fn: any): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }
}
