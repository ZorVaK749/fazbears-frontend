import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TimeoutError, firstValueFrom, timeout, timer } from 'rxjs';
import { API_BASE_URL } from '../../core/api.config';
import { CarritoService } from '../../core/services/carrito.service';
import { ConfirmacionPago, Cotizacion } from '../../core/services/pago.service';
import { ClpPipe } from '../../shared/clp.pipe';
import { WEBPAY_CART_REFERENCE, WEBPAY_PENDING_PAYMENT } from './webpay-session';

const FORM = 'https://webpay3gint.transbank.cl/webpayserver/initTransaction';
const RECHECK_DELAYS_MS = [1500, 3000, 5000];
interface Retorno { tokenWs: string | null; tbkToken: string | null; buyOrder: string | null; sessionId: string | null; }
interface PagoWebpay {
  pagoId: string; operacionId: string; estado: string; importe: number;
  moneda: string; simulacion: boolean;
}
interface CarritoWebpay { pagoId: string; usuarioId: string; tenantId: string; revisionCompra: string; }

@Component({
  standalone: true,
  selector: 'app-webpay',
  imports: [RouterLink, ClpPipe],
  template: `
    <main>
      @if (pedido(); as pedidoId) {
        <section class="payment-panel receipt" aria-labelledby="webpay-receipt" aria-live="polite">
          <h1 id="webpay-receipt" class="pixel text-neon-cyan">Pago efectuado</h1>
          <p>Pedido #{{ pedidoId }} confirmado por Webpay de integración.</p>
          <dl class="receipt-total"><dt>Total pagado</dt><dd>{{ total() | clp }}</dd></dl>
          @if (revisarCarrito()) {
            <p>Revisa el contenido del carrito antes de iniciar otra compra.</p>
          }
          <div class="payment-actions">
            <a class="payment-action payment-action--primary" routerLink="/checkout">Volver al checkout</a>
            <a class="payment-action" routerLink="/pedidos">Ver mis pedidos</a>
          </div>
        </section>
      } @else {
        <section class="payment-panel" aria-labelledby="webpay-status">
          <h1 id="webpay-status">{{ verificando() ? 'Verificando pago' : 'Webpay Plus de integración' }}</h1>
          <p role="status" aria-live="polite" class="payment-message">{{ mensaje() }}</p>
          <div class="payment-actions">
            @if (disponible() && !cerrado() && !verificando()) {
              @if (retorno || pendiente()) {
                <button type="button" class="payment-action payment-action--primary" (click)="retomar()">Verificar el mismo pago</button>
              } @else {
                <button type="button" class="payment-action payment-action--primary" [disabled]="ocupado()" (click)="iniciar()">Ir a Webpay</button>
              }
            }
            <a class="payment-action" [class.payment-action--primary]="cerrado()" routerLink="/checkout">Volver al checkout</a>
          </div>
        </section>
      }
    </main>
  `,
  styleUrl: '../../shared/payment-ui.css',
  styles: [`
    main { max-width: 48rem; margin: auto; padding: clamp(1rem, 4vw, 3rem); }
    .payment-panel { padding: clamp(1rem, 5vw, 2rem); background: var(--fnaf-surface); border: 1px solid var(--fnaf-border); border-radius: .375rem; }
    h1 { margin-bottom: .5rem; font-size: clamp(1.65rem, 5vw, 2.25rem); line-height: 1.1; }
    .payment-message { max-width: 56ch; }
    .receipt-total { margin-top: 1.25rem; }
    .receipt-total dd { font-size: 1.65rem; font-weight: 700; }
  `],
})
export class WebpayComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);
  private readonly route = inject(ActivatedRoute);
  private readonly cart = inject(CarritoService);
  private readonly destroy = inject(DestroyRef);
  private quote?: Cotizacion;
  private readonly quoteKey = crypto.randomUUID();
  private readonly paymentKey = crypto.randomUUID();
  readonly ocupado = signal(false);
  readonly verificando = signal(false);
  readonly disponible = signal(false);
  readonly pedido = signal<number | null>(null);
  readonly total = signal<number | null>(null);
  readonly cerrado = signal(false);
  readonly revisarCarrito = signal(false);
  readonly mensaje = signal('Comprobando disponibilidad…');
  readonly pendiente = signal(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT));
  retorno?: Retorno;

  async ngOnInit() {
    const { fragment, queryParamMap } = this.route.snapshot;
    const params = fragment ? new URLSearchParams(fragment) : queryParamMap;
    const fields = { tokenWs: params.get('token_ws'), tbkToken: params.get('TBK_TOKEN'),
      buyOrder: params.get('TBK_ORDEN_COMPRA'), sessionId: params.get('TBK_ID_SESION') };
    if (Object.values(fields).some(Boolean)) {
      this.retorno = fields;
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    if (this.retorno || this.pendiente()) {
      this.disponible.set(true);
      await this.retomar();
      return;
    }
    try {
      await firstValueFrom(this.http.get(`${this.api}/pagos/webpay/capacidad`).pipe(timeout(5000)));
      if (this.destroy.destroyed) return;
      this.disponible.set(true);
      this.mensaje.set('Usa los datos de prueba de Transbank. El servidor cotiza el carrito antes de abrir el formulario.');
    } catch {
      this.mensaje.set('Webpay de integración no está disponible en este entorno.');
    }
  }

  async iniciar() {
    if (this.ocupado() || this.pendiente() || this.retorno || this.cerrado()) return;
    this.ocupado.set(true);
    try {
      const snapshot = await this.cart.prepararCheckout();
      if (this.destroy.destroyed || !this.cart.snapshotVigente(snapshot)) throw new Error();
      this.quote ??= await this.post<Cotizacion>('/orden/cotizaciones', {
        items: snapshot.items.map(item => ({ productoId: item.productoId, cantidad: item.cantidad })),
      }, this.quoteKey);
      if (this.destroy.destroyed || !this.cart.mismaSesion(snapshot)
          || this.quote.ownerId !== snapshot.usuarioId || this.quote.tenantId !== snapshot.tenantId) throw new Error();
      const redirect = await this.post<{ pagoId: string; token: string; url: string }>('/pagos/webpay', {
        operacionId: this.quote.operacionId,
      }, this.paymentKey);
      if (this.destroy.destroyed || !this.cart.mismaSesion(snapshot) || redirect.url !== FORM
          || !/^[A-Za-z0-9]{20,128}$/.test(redirect.token)) throw new Error();
      sessionStorage.removeItem(WEBPAY_CART_REFERENCE);
      if (snapshot.revisionCompra) {
        const carrito: CarritoWebpay = { pagoId: redirect.pagoId, usuarioId: snapshot.usuarioId,
          tenantId: snapshot.tenantId, revisionCompra: snapshot.revisionCompra };
        sessionStorage.setItem(WEBPAY_CART_REFERENCE, JSON.stringify(carrito));
      }
      sessionStorage.setItem(WEBPAY_PENDING_PAYMENT, redirect.pagoId);
      this.pendiente.set(redirect.pagoId);
      const form = document.createElement('form');
      form.action = FORM;
      form.method = 'POST';
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'token_ws';
      hidden.value = redirect.token;
      form.append(hidden);
      document.body.append(form);
      form.submit();
      form.remove();
    } catch (error) {
      this.mensaje.set(error instanceof HttpErrorResponse && error.status === 422
        ? 'La cotización contiene fracciones de peso. Vuelve al checkout y actualiza el carrito para cotizar de nuevo.'
        : 'Inicio sin confirmar. Reintenta desde esta pantalla para conservar la cotización y la clave.');
    } finally {
      this.ocupado.set(false);
    }
  }

  async retomar() {
    if (this.ocupado() || (!this.retorno && !this.pendiente())) return;
    this.ocupado.set(true);
    this.verificando.set(true);
    this.mensaje.set('Estamos consultando el estado de tu pago en Webpay.');
    let aprobado = false;
    try {
      const pago = await this.verificarPago();
      if (this.destroy.destroyed || !pago) return;
      if (pago.estado === 'DECLINED' || pago.estado === 'EXPIRED') {
        this.mensaje.set(pago.estado === 'EXPIRED'
          ? 'Este intento de Webpay venció sin pago confirmado. Vuelve al checkout para obtener una nueva cotización.'
          : 'Transbank cerró este intento sin pago confirmado. Puedes volver al checkout.');
        this.cerrado.set(true);
        this.clear();
        return;
      }
      if (pago.estado === 'APPROVED') {
        aprobado = true;
        this.mensaje.set('Pago aprobado. Estamos confirmando tu pedido.');
        const pedido = await this.post<ConfirmacionPago>('/orden/confirmar-pago', {
          pagoId: pago.pagoId, operacionId: pago.operacionId,
        }, `webpay-${pago.pagoId}`);
        if (this.destroy.destroyed) return;
        if (!Number.isSafeInteger(pedido.pedidoId) || pedido.pedidoId < 1 || pedido.simulacion !== false || pedido.pagoId !== pago.pagoId
            || pedido.total !== pago.importe) throw new Error();
        this.revisarCarrito.set(!await this.actualizarCarrito(pago.pagoId));
        this.total.set(pedido.total);
        this.pedido.set(pedido.pedidoId);
        this.clear();
      } else {
        this.mensaje.set('Webpay aún no confirma el pago. Puedes volver a consultar este intento.');
      }
    } catch {
      if (this.destroy.destroyed) return;
      this.mensaje.set(aprobado
        ? 'Pago aprobado. Falta confirmar el pedido. Usa Verificar el mismo pago.'
        : 'Verificación pendiente. Reintenta desde esta pantalla con la cuenta que inició el pago.');
    } finally {
      this.verificando.set(false);
      this.ocupado.set(false);
    }
  }

  private async verificarPago(): Promise<PagoWebpay | null> {
    for (let intento = 0; intento <= RECHECK_DELAYS_MS.length; intento++) {
      if (intento > 0) {
        const turno = await firstValueFrom(timer(RECHECK_DELAYS_MS[intento - 1]).pipe(takeUntilDestroyed(this.destroy)),
          { defaultValue: null });
        if (turno === null) return null;
      }
      const id = this.pendiente();
      let pago: PagoWebpay;
      try {
        pago = this.retorno
          ? await this.post<PagoWebpay>('/pagos/webpay/retorno', this.retorno)
          : await this.post<PagoWebpay>(`/pagos/webpay/${encodeURIComponent(id!)}/estado`, {});
      } catch (error) {
        const transitorio = error instanceof TimeoutError || (error instanceof HttpErrorResponse
          && (error.status === 0 || error.status >= 500));
        if (!transitorio || intento === RECHECK_DELAYS_MS.length || this.destroy.destroyed) throw error;
        if (id && error instanceof HttpErrorResponse && error.error?.code === 'WEBPAY_STATUS_UNAVAILABLE') {
          this.retorno = undefined;
        }
        continue;
      }
      if (this.destroy.destroyed) return null;
      if (pago.simulacion !== false || pago.moneda !== 'CLP' || !pago.pagoId || (id && pago.pagoId !== id)) {
        throw new Error('Respuesta de pago incompatible.');
      }
      this.retorno = undefined;
      sessionStorage.setItem(WEBPAY_PENDING_PAYMENT, pago.pagoId);
      this.pendiente.set(pago.pagoId);
      if (pago.estado !== 'PENDING' || intento === RECHECK_DELAYS_MS.length) return pago;
    }
    return null;
  }

  private clear() {
    this.retorno = undefined;
    this.pendiente.set(null);
    sessionStorage.removeItem(WEBPAY_PENDING_PAYMENT);
    sessionStorage.removeItem(WEBPAY_CART_REFERENCE);
  }

  private async actualizarCarrito(pagoId: string): Promise<boolean> {
    try {
      const referencia = JSON.parse(sessionStorage.getItem(WEBPAY_CART_REFERENCE) ?? 'null') as CarritoWebpay | null;
      if (referencia?.pagoId !== pagoId || typeof referencia.usuarioId !== 'string'
          || typeof referencia.tenantId !== 'string' || typeof referencia.revisionCompra !== 'string'
          || !/^[a-f0-9]{64}$/.test(referencia.revisionCompra)) return false;
      return await this.cart.limpiarTrasWebpay(referencia, referencia.revisionCompra);
    } catch {
      return false;
    }
  }

  private post<T>(path: string, body: unknown, key?: string): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.api + path, body, {
      headers: key ? { 'Idempotency-Key': key } : {},
    }).pipe(timeout(15000)));
  }
}
