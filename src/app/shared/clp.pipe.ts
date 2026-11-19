import { Pipe, PipeTransform } from '@angular/core';

const formatoClp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  currencyDisplay: 'code',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

@Pipe({ name: 'clp', standalone: true })
export class ClpPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    // Show historic fractions when they exist. New prices and payments are whole pesos.
    return value != null && Number.isFinite(value) ? formatoClp.format(value) : '—';
  }
}
