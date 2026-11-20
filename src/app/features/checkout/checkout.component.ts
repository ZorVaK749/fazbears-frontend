import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CarritoService, IdentidadSesion } from '../../core/services/carrito.service';
import { InstrumentoPrueba, PagoService } from '../../core/services/pago.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { FazcoinsComponent } from '../../shared/fazcoins/fazcoins.component';
import { ClpPipe } from '../../shared/clp.pipe';
import { WEBPAY_PENDING_PAYMENT } from './webpay-session';

@Component({
  selector: 'app-checkout', standalone: true,
  imports: [FormsModule, RouterLink, NavbarComponent, FazcoinsComponent, ClpPipe],
  template: `
    <app-navbar />
    <main>
      <h1 class="pixel text-neon-cyan">Checkout</h1>
      <p>Elige un medio de pago de prueba.</p>
      @if (carritoSvc.sincronizando()) { <p role="status">Sincronizando carrito antes de confirmar…</p> }
      @if (carritoSvc.errorSincronizacion()) {
        <div role="alert">{{ carritoSvc.errorSincronizacion() }}
          <button class="btn-neon" (click)="carritoSvc.recargar()">ACTUALIZAR CARRITO</button>
        </div>
      }
      @if (pagoExitoso) {
        <section class="card-fnaf">
          <h2>Pago SIMULADO aprobado · pedido #{{ pedidoIdGenerado }} confirmado</h2>
          <p>Total simulado: {{ montoPagado | clp }}. Sin cargo real.</p>
          <a routerLink="/pedidos" class="btn-neon">VER MIS PEDIDOS</a>
        </section>
      } @else {
        <section class="card-fnaf">
          <h2>Resumen del carrito</h2>
          @for (item of carritoSvc.carrito().items; track item.productoId) {
            <p>{{ item.nombreProducto }} × {{ item.cantidad }} ·
              {{ item.precioVigente === false ? 'Sin precio vigente' : (item.precioUnitario * item.cantidad | clp) }}
            </p>
          } @empty { <p>No hay productos para pagar.</p> }
          <p>Total de referencia: {{ carritoSvc.carrito().total | clp }}. El servidor cotiza el importe final.</p>
          <div class="payment-options">
            <section class="payment-option" aria-labelledby="webpay-heading">
              <h3 id="webpay-heading">Webpay Plus de integración</h3>
              <p>Paga con una tarjeta de prueba en Transbank. La cotización debe estar en pesos enteros.</p>
              <button id="btn-webpay" type="button" class="btn-neon btn-neon-cyan"
                      [disabled]="procesando || (!webpayPendiente && pagoSvc.pendiente())"
                      routerLink="/checkout/webpay">{{ webpayPendiente ? 'VERIFICAR PAGO WEBPAY' : 'CONTINUAR CON WEBPAY' }}</button>
              @if (procesando || (!webpayPendiente && pagoSvc.pendiente())) {
                <p role="status">Resuelve primero el pago simulado de esta sesión.</p>
              }
            </section>
            <section class="payment-option" aria-labelledby="simulation-heading">
              <h3 id="simulation-heading">Pago simulado</h3>
              @if (webpayPendiente) { <p role="status">Verifica el pago Webpay pendiente antes de iniciar otro pago.</p> }
              <label for="instrumento">Instrumento de simulación</label>
              <select id="instrumento" [(ngModel)]="instrumento" [disabled]="procesando || pagoSvc.pendiente() || webpayPendiente">
                <option value="sim-approved">sim-approved · aprobación de prueba</option>
                <option value="sim-declined">sim-declined · rechazo de prueba</option>
              </select>
              <p>El reintento conserva la cotización y el instrumento original.</p>
              <button id="btn-confirmar-pago" class="btn-neon" [disabled]="procesando || webpayPendiente" (click)="procesarPago()">
                {{ procesando ? 'PROCESANDO…' : pagoSvc.pendiente() ? 'REINTENTAR MISMA OPERACIÓN' : 'CONFIRMAR PAGO SIMULADO' }}
              </button>
              <button class="btn-neon" [disabled]="procesando || webpayPendiente" (click)="nuevoIntento()">Nuevo intento tras rechazo o bloqueo</button>
            </section>
          </div>
        </section>
      }
      @if (errorMsg) { <p role="alert">{{ errorMsg }}</p> }
      <app-fazcoins />
      <a routerLink="/catalogo" class="btn-neon">VOLVER AL CATÁLOGO</a>
    </main>
  `,
  styles: [`
    main { max-width: 900px; margin: auto; padding: 2rem; }
    section { padding: 1.5rem; margin: 1rem 0; }
    h1 { font-size: 1.5rem; }
    .payment-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: 1rem; margin-top: 1.25rem; }
    .payment-option { border: 1px solid var(--fnaf-muted); margin: 0; padding: 1rem; }
    .payment-option h3 { color: var(--fnaf-cyan); margin-bottom: .65rem; }
    .payment-option button, select { margin-block: .5rem; max-width: 100%; }
    .payment-option button:disabled { cursor: not-allowed; opacity: .55; }
  `],
})
export class CheckoutComponent {
  carritoSvc = inject(CarritoService);
  pagoSvc = inject(PagoService);
  readonly webpayPendiente = Boolean(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT));
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
    if (this.procesando || this.pagoExitoso || this.webpayPendiente) return;
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
