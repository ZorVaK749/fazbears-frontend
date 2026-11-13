import { Component, effect, inject, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { CarritoService, IdentidadSesion } from '../../core/services/carrito.service';
import { FidelizacionService, Saldo, Movimiento, Recompensa } from '../../core/services/fidelizacion.service';

@Component({
  selector: 'app-fazcoins', standalone: true, imports: [JsonPipe],
  template: `
    <section class="card-fnaf" aria-label="FazCoins">
      <h2 class="pixel text-neon-yellow">FazCoins · recompensas digitales</h2>
      <p>Simulación de fidelización. Los canjes no son pagos ni descuentan el precio del pedido.</p>
      @if (vigente()) {
        @if (saldo()) {
          <p>Saldo: {{ saldo()!.saldo }} Fz · Disponible: {{ saldo()!.disponible }} Fz · Deuda: {{ saldo()!.deuda }} Fz</p>
        }
        @for (r of recompensas(); track r.id) {
          <button class="btn-neon" [disabled]="ocupado()" (click)="canjear(r.id)">Canjear {{ r.nombre }} · {{ r.costo }} Fz</button>
        }
        <h3>Movimientos</h3>
        @for (m of movimientos(); track $index) { <pre>{{ m | json }}</pre> }
        @empty { <p>Sin movimientos registrados.</p> }
        @if (mensaje()) { <p role="status">{{ mensaje() }}</p> }
      }
      <button class="btn-neon" [disabled]="ocupado()" (click)="cargar()">Actualizar FazCoins</button>
    </section>
  `,
  styles: [`section { padding: 1.5rem; margin: 1rem 0; } h2 { font-size: 1rem; } pre { white-space: pre-wrap; overflow-wrap: anywhere; } button { margin: .4rem; }`],
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
  ocupado = signal(false);
  constructor() {
    effect(() => {
      const identidad = this.carrito.identidadVerificada();
      this.identidad = identidad ?? undefined;
      this.saldo.set(null); this.movimientos.set([]); this.recompensas.set([]); this.mensaje.set('');
      if (identidad && this.carrito.esIdentidadActual(identidad)) this.cargar();
    });
    void this.carrito.inicializar();
  }
  vigente() { return !!this.identidad && this.carrito.esIdentidadActual(this.identidad); }
  cargar() {
    const identidad = this.identidad;
    if (!identidad || !this.carrito.esIdentidadActual(identidad)) return;
    forkJoin({ saldo: this.svc.saldo(), movimientos: this.svc.movimientos(), recompensas: this.svc.recompensas() })
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: data => {
          if (!this.carrito.esIdentidadActual(identidad)) return;
          this.saldo.set(data.saldo); this.movimientos.set(data.movimientos); this.recompensas.set(data.recompensas);
        }, error: () => { if (this.carrito.esIdentidadActual(identidad)) this.mensaje.set('No se pudo cargar FazCoins. Actualiza para reintentar.'); },
      });
  }
  async canjear(id: string) {
    if (this.ocupado() || !this.vigente()) return;
    const identidad = this.identidad!;
    this.ocupado.set(true); this.mensaje.set('');
    try {
      await this.svc.solicitarCanje(id);
      if (!this.destroy.destroyed && this.carrito.esIdentidadActual(identidad)) {
        this.mensaje.set('Recompensa digital canjeada. El total del pedido no cambia.'); this.cargar();
      }
    } catch (e) {
      if (!this.destroy.destroyed && this.carrito.esIdentidadActual(identidad)) this.mensaje.set((e as Error).message);
    } finally { if (!this.destroy.destroyed) this.ocupado.set(false); }
  }
}
