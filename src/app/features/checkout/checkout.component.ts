import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CarritoService, IdentidadSesion } from '../../core/services/carrito.service';
import { InstrumentoPrueba, PagoService } from '../../core/services/pago.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { FazcoinsComponent } from '../../shared/fazcoins/fazcoins.component';

@Component({
  selector: 'app-checkout', standalone: true,
  imports: [FormsModule, RouterLink, NavbarComponent, FazcoinsComponent],
  template: `
    <app-navbar />
    <main>
      <h1 class="pixel text-neon-cyan">Pago simulado</h1>
      <p>No se realizan cargos reales. No ingreses datos bancarios.</p>
      @if (carritoSvc.sincronizando()) { <p role="status">Sincronizando carrito antes de confirmar…</p> }
      @if (carritoSvc.errorSincronizacion()) {
        <div role="alert">{{ carritoSvc.errorSincronizacion() }}
          <button class="btn-neon" (click)="carritoSvc.recargar()">ACTUALIZAR CARRITO</button>
        </div>
      }
      @if (pagoExitoso) {
        <section class="card-fnaf">
          <h2>Pago SIMULADO aprobado · pedido #{{ pedidoIdGenerado }} confirmado</h2>
          <p>Total simulado: {{ montoPagado }}. Sin cargo real.</p>
          <a routerLink="/pedidos" class="btn-neon">VER MIS PEDIDOS</a>
        </section>
      } @else {
        <section class="card-fnaf">
          <h2>Resumen del carrito</h2>
          @for (item of carritoSvc.carrito().items; track item.productoId) {
            <p>{{ item.nombreProducto }} × {{ item.cantidad }} · {{ item.precioUnitario * item.cantidad }}</p>
          } @empty { <p>No hay productos para pagar.</p> }
          <p>Total de referencia: {{ carritoSvc.carrito().total }}. El servidor cotiza el importe final.</p>
          <label for="instrumento">Instrumento de simulación</label>
          <select id="instrumento" [(ngModel)]="instrumento" [disabled]="procesando || pagoSvc.pendiente()">
            <option value="sim-approved">sim-approved · aprobación de prueba</option>
            <option value="sim-declined">sim-declined · rechazo de prueba</option>
          </select>
          <p>Un resultado incierto conserva la cotización y el instrumento original. Reintenta sin iniciar otro pago.</p>
          <button id="btn-confirmar-pago" class="btn-neon" [disabled]="procesando" (click)="procesarPago()">
            {{ procesando ? 'PROCESANDO…' : pagoSvc.pendiente() ? 'REINTENTAR MISMA OPERACIÓN' : 'CONFIRMAR PAGO SIMULADO' }}
          </button>
          <button class="btn-neon" [disabled]="procesando" (click)="nuevoIntento()">Nuevo intento solo tras rechazo/bloqueo definitivo</button>
        </section>
      }
      @if (errorMsg) { <p role="alert">{{ errorMsg }}</p> }
      <app-fazcoins />
      <a routerLink="/catalogo" class="btn-neon">VOLVER AL CATÁLOGO</a>
    </main>
  `,
  styles: [`main { max-width: 900px; margin: auto; padding: 2rem; } section { padding: 1.5rem; margin: 1rem 0; } button, select { margin: .5rem; } h1 { font-size: 1.5rem; }`],
})
export class CheckoutComponent {
  carritoSvc = inject(CarritoService);
  pagoSvc = inject(PagoService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  instrumento: InstrumentoPrueba = 'sim-approved';
  procesando = false;
  private exito = false;
  private identidadExito?: Readonly<IdentidadSesion>;
  get pagoExitoso() { return this.exito && !!this.identidadExito && this.carritoSvc.esIdentidadActual(this.identidadExito); }
  pedidoIdGenerado: number | null = null;
  montoPagado = 0;
  errorMsg = '';
  nuevoIntento() { this.pagoSvc.nuevoIntento(); this.errorMsg = ''; }
  async procesarPago() {
    if (this.procesando || this.pagoExitoso) return;
    this.procesando = true; this.errorMsg = '';
    try {
      const res = await this.pagoSvc.procesar(this.instrumento, () => !this.destroyRef.destroyed);
      if (this.destroyRef.destroyed) return;
      this.identidadExito = this.carritoSvc.identidadVerificada() ?? undefined;
      this.exito = true; this.pedidoIdGenerado = res.pedidoId; this.montoPagado = res.total;
    } catch (error) {
      if (!this.destroyRef.destroyed) this.errorMsg = (error as Error).message;
    } finally {
      if (!this.destroyRef.destroyed) { this.procesando = false; this.cdr.markForCheck(); }
    }
  }
}
