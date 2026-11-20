import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { API_BASE_URL } from '../../core/api.config';
import { CarritoService } from '../../core/services/carrito.service';
import { ConfirmacionPago, Cotizacion } from '../../core/services/pago.service';
import { ClpPipe } from '../../shared/clp.pipe';
import { WEBPAY_PENDING_PAYMENT } from './webpay-session';

const FORM = 'https://webpay3gint.transbank.cl/webpayserver/initTransaction';
interface Retorno { tokenWs: string | null; tbkToken: string | null; buyOrder: string | null; sessionId: string | null; }
interface PagoWebpay {
  pagoId: string; operacionId: string; estado: string; importe: number;
  moneda: string; simulacion: boolean;
}

@Component({
  standalone: true,
  selector: 'app-webpay',
  imports: [RouterLink, ClpPipe],
  template: `
    <main>
      @if (pedido(); as pedidoId) {
        <section class="card-fnaf receipt" aria-labelledby="webpay-receipt" aria-live="polite">
          <h1 id="webpay-receipt" class="pixel text-neon-cyan">Pago efectuado</h1>
          <p>Webpay de integración verificó el pago y se confirmó el pedido #{{ pedidoId }}.</p>
          <p>Total pagado en integración: <strong>{{ total() | clp }}</strong></p>
          <div class="actions">
            <a class="btn-neon btn-neon-cyan" routerLink="/checkout">Volver al checkout</a>
            <a class="btn-neon" routerLink="/pedidos">Ver mis pedidos</a>
          </div>
        </section>
      } @else {
        <h1>Webpay Plus de integración</h1>
        <p>Usa los datos de prueba oficiales de Transbank en su formulario de integración.</p>
        <p role="status">{{ mensaje() }}</p>
        <div class="actions">
          @if (disponible() && !cerrado()) {
            @if (retorno || pendiente()) {
              <button class="btn-neon" [disabled]="ocupado()" (click)="retomar()">Verificar el mismo pago</button>
            } @else {
              <button class="btn-neon" [disabled]="ocupado()" (click)="iniciar()">Ir a Webpay</button>
            }
          }
          <a routerLink="/checkout">Volver al checkout</a>
        </div>
      }
    </main>
  `,
  styles: [`
    main { max-width: 780px; margin: auto; padding: 2rem; }
    .receipt { padding: clamp(1rem, 5vw, 2rem); }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin-top: 1rem; }
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
  readonly disponible = signal(false);
  readonly pedido = signal<number | null>(null);
  readonly total = signal<number | null>(null);
  readonly cerrado = signal(false);
  readonly mensaje = signal('Comprobando disponibilidad…');
  readonly pendiente = signal(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT));
  retorno?: Retorno;

  async ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
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
      this.mensaje.set('El servidor cotiza el carrito antes de abrir Transbank.');
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
    const id = this.pendiente();
    const retorno = this.retorno;
    if (this.ocupado() || (!retorno && !id)) return;
    this.ocupado.set(true);
    let aprobado = false;
    try {
      const pago = retorno
        ? await this.post<PagoWebpay>('/pagos/webpay/retorno', retorno)
        : await this.post<PagoWebpay>(`/pagos/webpay/${encodeURIComponent(id!)}/estado`, {});
      if (this.destroy.destroyed || pago.simulacion !== false || pago.moneda !== 'CLP'
          || (id && pago.pagoId !== id)) throw new Error();
      if (pago.estado === 'DECLINED') {
        this.mensaje.set('Transbank cerró este intento sin pago confirmado. Puedes volver al checkout.');
        this.cerrado.set(true);
        this.clear();
        return;
      }
      this.retorno = undefined;
      sessionStorage.setItem(WEBPAY_PENDING_PAYMENT, pago.pagoId);
      this.pendiente.set(pago.pagoId);
      if (pago.estado === 'APPROVED') {
        aprobado = true;
        const pedido = await this.post<ConfirmacionPago>('/orden/confirmar-pago', {
          pagoId: pago.pagoId, operacionId: pago.operacionId,
        }, `webpay-${pago.pagoId}`);
        if (this.destroy.destroyed) return;
        if (!Number.isSafeInteger(pedido.pedidoId) || pedido.pedidoId < 1 || pedido.simulacion !== false || pedido.pagoId !== pago.pagoId
            || pedido.total !== pago.importe) throw new Error();
        this.total.set(pedido.total);
        this.pedido.set(pedido.pedidoId);
        this.clear();
      } else {
        this.mensaje.set(retorno && !retorno.tokenWs
          ? 'Transbank devolvió una cancelación o expiración. La transacción no está aprobada.'
          : 'Pago sin aprobación confirmada. Verifica el mismo pago antes de iniciar otro.');
      }
    } catch {
      this.mensaje.set(aprobado
        ? 'Pago aprobado. Falta confirmar el pedido. Usa Verificar el mismo pago.'
        : 'Verificación pendiente. Reintenta desde esta pantalla con la cuenta que inició el pago.');
    } finally {
      this.ocupado.set(false);
    }
  }

  private clear() {
    this.retorno = undefined;
    this.pendiente.set(null);
    sessionStorage.removeItem(WEBPAY_PENDING_PAYMENT);
  }

  private post<T>(path: string, body: unknown, key?: string): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.api + path, body, {
      headers: key ? { 'Idempotency-Key': key } : {},
    }).pipe(timeout(15000)));
  }
}
