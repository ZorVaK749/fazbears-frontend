import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CarritoService, IdentidadSesion } from '../../core/services/carrito.service';
import { FidelizacionService, Saldo, Movimiento, Recompensa } from '../../core/services/fidelizacion.service';
import { formatearFechaSantiago } from '../fecha-santiago';

const formatoMovimiento = new Intl.NumberFormat('es-CL', { signDisplay: 'exceptZero' });

@Component({
  selector: 'app-fazcoins', standalone: true,
  template: `
    <section aria-label="FazCoins">
      <h2 class="pixel text-neon-yellow">FazCoins · recompensas digitales</h2>
      <p>Simulación de fidelización. Los canjes no son pagos ni descuentan el precio del pedido.</p>
      @if (vigente()) {
        @if (saldo()) {
          <p>Saldo: {{ saldo()!.saldo }} Fz · Disponible: {{ saldo()!.disponible }} Fz · Deuda: {{ saldo()!.deuda }} Fz</p>
          <div class="payment-actions">
            @for (r of recompensas(); track r.id) {
              <button type="button" class="payment-action" [disabled]="ocupado()" (click)="canjear(r.id)">Canjear {{ r.nombre }} · {{ r.costo }} Fz</button>
            }
          </div>
          <h3>Movimientos</h3>
          @if (movimientos().length) {
            <ul class="historial" aria-label="Movimientos de FazCoins">
              @for (movimiento of movimientos(); track movimiento.id) {
                <li>
                  <div>
                    <strong>{{ tituloMovimiento(movimiento.tipo) }}</strong>
                    <span class="fecha">{{ formatFecha(movimiento.creadoEn) }}</span>
                  </div>
                  <strong class="monedas" [class.abono]="movimiento.monedas > 0">
                    {{ formatMonedas(movimiento.monedas) }}
                  </strong>
                </li>
              }
            </ul>
          } @else { <p>Sin movimientos registrados.</p> }
        }
        @if (mensajeCarga() || mensaje()) { <p role="status">{{ mensajeCarga() || mensaje() }}</p> }
      }
      <div class="payment-actions">
        <button type="button" class="payment-action" [disabled]="ocupado()" (click)="cargar()">Actualizar FazCoins</button>
      </div>
    </section>
  `,
  styleUrl: '../payment-ui.css',
  styles: [`
    section { padding: clamp(1rem, 4vw, 1.5rem); margin-block: 1rem; background: var(--fnaf-surface); border: 1px solid var(--fnaf-border); border-radius: .375rem; }
    h2 { margin-bottom: .35rem; font-size: 1.35rem; }
    h3 { margin-top: .75rem; }
    .historial { display: grid; gap: .4rem; margin-block: .5rem 0; }
    .historial li { display: flex; flex-wrap: wrap; gap: .25rem 1rem; justify-content: space-between; align-items: center; padding: .6rem .75rem; background: var(--fnaf-surface2); border-radius: .3rem; }
    .fecha { display: block; color: #b5b5cb; font-size: .9rem; }
    .monedas { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .abono { color: var(--fnaf-cyan); }
  `],
})
export class FazcoinsComponent {
  private svc = inject(FidelizacionService);
  private carrito = inject(CarritoService);
  private destroy = inject(DestroyRef);
  private identidad?: Readonly<IdentidadSesion>;
  saldo = signal<Saldo | null>(null);
  movimientos = signal<Movimiento[]>([]);
  recompensas = signal<Recompensa[]>([]);
  mensaje = signal('');
  mensajeCarga = signal('');
  ocupado = signal(false);
  protected readonly formatFecha = formatearFechaSantiago;

  protected tituloMovimiento(tipo: string): string {
    switch (tipo) {
      case 'AWARD': return 'Abono por compra simulada';
      case 'REDEMPTION': return 'Canje de recompensa';
      case 'REVERSAL': return 'Reversión de abono';
      default: return 'Movimiento de FazCoins';
    }
  }

  protected formatMonedas(monedas: number): string {
    return Number.isSafeInteger(monedas) ? `${formatoMovimiento.format(monedas)} Fz` : '—';
  }

  constructor() {
    effect(() => {
      const identidad = this.carrito.identidadVerificada();
      this.identidad = identidad ?? undefined;
      this.saldo.set(null); this.movimientos.set([]); this.recompensas.set([]);
      this.mensaje.set(''); this.mensajeCarga.set('');
      if (identidad && this.carrito.esIdentidadActual(identidad)) this.cargar();
    });
    void this.carrito.inicializar();
  }
  vigente() { return !!this.identidad && this.carrito.esIdentidadActual(this.identidad); }
  cargar() {
    const identidad = this.identidad;
    if (!identidad || !this.carrito.esIdentidadActual(identidad)) return;
    this.mensajeCarga.set('');
    forkJoin({ saldo: this.svc.saldo(), movimientos: this.svc.movimientos(), recompensas: this.svc.recompensas() })
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: data => {
          if (!this.carrito.esIdentidadActual(identidad)) return;
          this.saldo.set(data.saldo); this.movimientos.set(data.movimientos); this.recompensas.set(data.recompensas);
        }, error: (error: unknown) => {
          if (!this.carrito.esIdentidadActual(identidad)) return;
          if (error instanceof HttpErrorResponse && error.status === 404) {
            this.saldo.set(null); this.movimientos.set([]); this.recompensas.set([]);
            this.mensajeCarga.set('FazCoins no está disponible en este entorno.');
          } else {
            this.mensajeCarga.set('No se pudo cargar FazCoins. Actualiza para reintentar.');
          }
        },
      });
  }
  async canjear(id: string) {
    if (this.ocupado() || !this.vigente()) return;
    const identidad = this.identidad!;
    this.ocupado.set(true); this.mensaje.set('');
    try {
      await this.svc.solicitarCanje(id);
      if (!this.destroy.destroyed && this.carrito.esIdentidadActual(identidad)) {
        this.mensaje.set('Recompensa canjeada.'); this.cargar();
      }
    } catch (e) {
      if (!this.destroy.destroyed && this.carrito.esIdentidadActual(identidad)) this.mensaje.set((e as Error).message);
    } finally { if (!this.destroy.destroyed) this.ocupado.set(false); }
  }
}
