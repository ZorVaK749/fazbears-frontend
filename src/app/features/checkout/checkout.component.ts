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
          <div class="payment-actions"><button type="button" class="payment-action" (click)="carritoSvc.recargar()">Actualizar carrito</button></div>
        </div>
      }
      @if (pagoExitoso) {
        <section class="checkout-panel">
          <h2>Pago SIMULADO aprobado · pedido #{{ pedidoIdGenerado }} confirmado</h2>
          <p>Total simulado: {{ montoPagado | clp }}. Sin cargo real.</p>
          <div class="payment-actions"><a routerLink="/pedidos" class="payment-action payment-action--primary">Ver mis pedidos</a></div>
        </section>
      } @else {
        <section class="checkout-panel">
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
              <div class="payment-actions">
                <button id="btn-webpay" type="button" class="payment-action payment-action--primary"
                        [disabled]="procesando || (!webpayPendiente && pagoSvc.pendiente())"
                        routerLink="/checkout/webpay">{{ webpayPendiente ? 'Verificar pago Webpay' : 'Continuar con Webpay' }}</button>
              </div>
              @if (procesando || (!webpayPendiente && pagoSvc.pendiente())) {
                <p role="status">Resuelve primero el pago simulado de esta sesión.</p>
              }
            </section>
            <section class="payment-option" aria-labelledby="simulation-heading">
              <h3 id="simulation-heading">Pago simulado</h3>
              @if (webpayPendiente) { <p role="status">Verifica el pago Webpay pendiente antes de iniciar otro pago.</p> }
              <div class="payment-field">
                <label for="instrumento">Resultado de prueba</label>
                <select id="instrumento" [(ngModel)]="instrumento" [disabled]="procesando || pagoSvc.pendiente() || webpayPendiente">
                  <option value="sim-approved">Aprobación</option>
                  <option value="sim-declined">Rechazo</option>
                </select>
              </div>
              <div class="payment-actions">
                @if (pagoSvc.puedeNuevoIntento() && !webpayPendiente) {
                  <button type="button" class="payment-action" (click)="nuevoIntento()">Nuevo intento</button>
                } @else {
                  <button id="btn-confirmar-pago" type="button" class="payment-action" [disabled]="procesando || webpayPendiente" (click)="procesarPago()">
                    {{ procesando ? 'Procesando…' : pagoSvc.pendiente() ? 'Reintentar misma operación' : 'Confirmar pago simulado' }}
                  </button>
                }
              </div>
            </section>
          </div>
        </section>
      }
      @if (errorMsg) { <p role="alert">{{ errorMsg }}</p> }
      <app-fazcoins />
      <div class="payment-actions"><a routerLink="/catalogo" class="payment-action">Volver al catálogo</a></div>
    </main>
  `,
  styleUrl: '../../shared/payment-ui.css',
  styles: [`
    main { max-width: 58rem; margin: auto; padding: clamp(1rem, 4vw, 2rem); }
    .checkout-panel { padding: clamp(1rem, 4vw, 1.5rem); margin-block: 1rem; background: var(--fnaf-surface); border: 1px solid var(--fnaf-border); border-radius: .375rem; }
    h1 { font-size: clamp(1.65rem, 5vw, 2.25rem); }
    h2 { margin-bottom: .35rem; font-size: 1.35rem; }
    .payment-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: 1rem; margin-top: 1.25rem; }
    .payment-option { min-width: 0; border: 1px solid var(--fnaf-border); border-radius: .25rem; padding: 1rem; background: var(--fnaf-bg); }
    .payment-option h3 { color: var(--fnaf-cyan); margin-bottom: .45rem; font-size: 1.2rem; line-height: 1.15; }
    .payment-option [role="status"] { margin-top: .5rem; }
    .payment-field { display: grid; gap: .3rem; margin-top: .75rem; }
    select { min-height: 2.75rem; width: 100%; padding: .4rem .6rem; border: 1px solid var(--fnaf-muted); border-radius: .25rem; color-scheme: dark; background: var(--fnaf-surface2); color: var(--fnaf-text); }
    select:focus-visible { outline: 2px solid var(--fnaf-yellow); outline-offset: 2px; }
    select:disabled { opacity: .6; cursor: not-allowed; }
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
