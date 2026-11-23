import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { vi } from 'vitest';
import { API_BASE_URL } from '../../core/api.config';
import { AZURE_TENANT_ID } from '../../core/auth/auth.config';
import { CarritoService } from '../../core/services/carrito.service';
import { WebpayComponent } from './webpay.component';
import { WEBPAY_CART_REFERENCE, WEBPAY_PENDING_PAYMENT } from './webpay-session';

describe('Webpay integration return', () => {
  const paymentId = '42ff2362-6631-4a0b-9ba2-07d1193fa61d';

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.removeItem(WEBPAY_PENDING_PAYMENT);
    sessionStorage.removeItem(WEBPAY_CART_REFERENCE);
  });

  const turno = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  function setup(fragment: string | null = null,
    query: Record<string, string> = fragment ? {} : { token_ws: 'provider-reference-for-test' }) {
    const cart = { limpiarTrasWebpay: vi.fn().mockResolvedValue(true) };
    const snapshot = { fragment, queryParamMap: convertToParamMap(query) };
    TestBed.configureTestingModule({
      imports: [WebpayComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: CarritoService, useValue: cart },
        { provide: ActivatedRoute, useValue: { snapshot } },
      ],
    });
    const fixture = TestBed.createComponent(WebpayComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectNone('/api/pagos/webpay/capacidad');
    return { fixture, http, snapshot, cart };
  }

  const pagoAprobado = { pagoId: paymentId, operacionId: 'op-1', estado: 'APPROVED', importe: 12990,
    moneda: 'CLP', simulacion: false };
  const referencia = { pagoId: paymentId, usuarioId: 'owner', tenantId: 'tenant', revisionCompra: 'a'.repeat(64) };

  it.each(['EXPIRED', 'APPROVED'])('consults a saved attempt only after the user clicks (%s)', async estado => {
    const { fixture, http, cart } = setup(null, { recuperar: paymentId });
    http.expectNone(() => true);
    const button = fixture.nativeElement.querySelector('button');
    expect(button.textContent).toContain('Verificar el mismo pago');
    button.click();
    const request = http.expectOne(`/api/pagos/webpay/${paymentId}/estado`);
    expect(request.request.method).toBe('POST');
    request.flush({ ...pagoAprobado, estado });
    await turno();
    expect(fixture.componentInstance.cerrado()).toBe(true);
    expect(fixture.componentInstance.mensaje()).toContain(estado === 'EXPIRED' ? 'venció' : 'figura aprobado');
    expect(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT)).toBeNull();
    expect(cart.limpiarTrasWebpay).not.toHaveBeenCalled();
    http.expectNone('/api/pagos/webpay');
    http.expectNone('/api/orden/confirmar-pago');
    http.verify();
  });

  it('preserves a different payment already pending in the tab', () => {
    const otherPayment = '7f5da553-51ad-4f65-bc18-dde943b58708';
    sessionStorage.setItem(WEBPAY_PENDING_PAYMENT, otherPayment);
    const { fixture, http } = setup(null, { recuperar: paymentId });
    expect(fixture.componentInstance.mensaje()).toContain('otro pago pendiente');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT)).toBe(otherPayment);
    http.expectNone(() => true);
    http.verify();
  });

  it.each([false, true])('preserves the quoted cart revision across the Webpay return (cart edited after retryable error: %s)', async edited => {
    const snapshot = { fragment: null, queryParamMap: convertToParamMap({}) };
    const account = { homeAccountId: 'home-owner', localAccountId: 'owner', tenantId: AZURE_TENANT_ID };
    const owner = { usuarioId: 'owner', tenantId: AZURE_TENANT_ID };
    const revisionCompra = 'a'.repeat(64);
    const items = [{ id: 8, productoId: 7, nombreProducto: 'Pizza', cantidad: 1, precioUnitario: 12990 }];
    const changedCart = { ...owner, items: [{ ...items[0], cantidad: 2 }], revisionCompra: 'b'.repeat(64) };
    TestBed.configureTestingModule({
      imports: [WebpayComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => account } } },
        { provide: ActivatedRoute, useValue: { snapshot } },
      ],
    });
    const cart = TestBed.inject(CarritoService);
    const http = TestBed.inject(HttpTestingController);
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const initial = TestBed.createComponent(WebpayComponent);
    initial.detectChanges();
    http.expectOne('/api/pagos/webpay/capacidad').flush({});
    try {
      let start = initial.componentInstance.iniciar();
      await turno();
      http.expectOne('/api/carrito/me').flush(owner);
      await turno();
      http.expectOne('/api/carrito/owner').flush({ ...owner, items, revisionCompra });
      await turno();
      const quote = http.expectOne('/api/orden/cotizaciones');
      expect(quote.request.body).toEqual({ items: [{ productoId: 7, cantidad: 1 }] });
      quote.flush({ operacionId: 'op-1', ownerId: owner.usuarioId, tenantId: owner.tenantId });
      await turno();
      let beginPayment = http.expectOne('/api/pagos/webpay');
      if (edited) {
        const key = beginPayment.request.headers.get('Idempotency-Key');
        beginPayment.flush(null, { status: 503, statusText: 'Unavailable' });
        await start;
        cart.cambiarCantidad(7, 2);
        await turno();
        http.expectOne('/api/carrito/owner/items').flush(changedCart);
        start = initial.componentInstance.iniciar();
        await turno();
        http.expectNone('/api/orden/cotizaciones');
        beginPayment = http.expectOne('/api/pagos/webpay');
        expect(beginPayment.request.headers.get('Idempotency-Key')).toBe(key);
      }
      const token = 'syntheticwebpaytoken000000';
      beginPayment.flush({ pagoId: paymentId, token,
        url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' });
      await start;
      expect(submit).toHaveBeenCalledOnce();
      expect(JSON.parse(sessionStorage.getItem(WEBPAY_CART_REFERENCE)!)).toEqual({ ...owner, pagoId: paymentId, revisionCompra });
      initial.destroy();
      cart.cerrarSesion();

      snapshot.queryParamMap = convertToParamMap({ token_ws: token });
      const returned = TestBed.createComponent(WebpayComponent);
      returned.detectChanges();
      http.expectOne('/api/pagos/webpay/retorno').flush(pagoAprobado);
      await turno();
      http.expectOne('/api/orden/confirmar-pago').flush({ pedidoId: 31, pagoId: paymentId, total: 12990, simulacion: false });
      await turno();
      http.expectOne('/api/carrito/me').flush(owner);
      await turno();
      const currentCart = edited ? changedCart : { ...owner, items, revisionCompra };
      http.expectOne('/api/carrito/owner').flush(currentCart);
      await turno();
      http.expectOne('/api/carrito/owner').flush(currentCart);
      await turno();
      if (edited) {
        http.expectNone(request => request.method === 'DELETE');
      } else {
        const cleanup = http.expectOne(`/api/carrito/owner/items/comprados?revision=${revisionCompra}`);
        expect(cleanup.request.method).toBe('DELETE');
        cleanup.flush({ ...owner, items: [] });
        await turno();
      }
      expect(cart.cantidadItems).toBe(edited ? 2 : 0);
      expect(returned.componentInstance.pedido()).toBe(31);
      expect(returned.componentInstance.revisarCarrito()).toBe(edited);
      http.verify();
    } finally {
      submit.mockRestore();
    }
  });

  it('reconciles a cancelled form return without confirming an order', async () => {
    sessionStorage.setItem(WEBPAY_CART_REFERENCE, JSON.stringify(referencia));
    const { fixture, http, cart } = setup('TBK_TOKEN=cancelled-test-reference&TBK_ORDEN_COMPRA=test-order&TBK_ID_SESION=test-session');
    const verify = http.expectOne('/api/pagos/webpay/retorno');
    expect(verify.request.body).toEqual({ tokenWs: null, tbkToken: 'cancelled-test-reference',
      buyOrder: 'test-order', sessionId: 'test-session' });
    verify.flush({ ...pagoAprobado, estado: 'DECLINED' });
    await turno();
    expect(fixture.componentInstance.cerrado()).toBe(true);
    expect(cart.limpiarTrasWebpay).not.toHaveBeenCalled();
    http.expectNone('/api/orden/confirmar-pago');
    http.verify();
  });

  it('requests order confirmation only after server approval of the provider return', async () => {
    sessionStorage.setItem(WEBPAY_CART_REFERENCE, JSON.stringify(referencia));
    const { fixture, http, cart } = setup();
    const verify = http.expectOne('/api/pagos/webpay/retorno');
    expect(verify.request.body.tokenWs).toBe('provider-reference-for-test');
    http.expectNone('/api/orden/confirmar-pago');
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Verificando pago');
    verify.flush(pagoAprobado);
    await turno();
    const confirm = http.expectOne('/api/orden/confirmar-pago');
    expect(confirm.request.headers.get('Idempotency-Key')).toBe(`webpay-${paymentId}`);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#webpay-receipt')).toBeNull();
    expect(cart.limpiarTrasWebpay).not.toHaveBeenCalled();
    confirm.flush({ pedidoId: 31, pagoId: paymentId, total: 12990, simulacion: false });
    await turno();
    fixture.detectChanges();
    expect(fixture.componentInstance.pedido()).toBe(31);
    expect(fixture.nativeElement.querySelector('#webpay-receipt').textContent).toContain('Pago efectuado');
    expect(fixture.nativeElement.querySelector('.receipt').textContent).toContain('Pedido #31');
    expect(fixture.nativeElement.querySelector('.receipt a[href="/checkout"]').textContent).toContain('Volver al checkout');
    expect(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT)).toBeNull();
    expect(sessionStorage.getItem(WEBPAY_CART_REFERENCE)).toBeNull();
    expect(cart.limpiarTrasWebpay).toHaveBeenCalledExactlyOnceWith(referencia, referencia.revisionCompra);
    http.verify();
  });

  it('resumes the same payment after a failed return and after a failed order confirmation', async () => {
    sessionStorage.setItem(WEBPAY_PENDING_PAYMENT, paymentId);
    const { fixture, http, snapshot } = setup();
    http.expectOne('/api/pagos/webpay/retorno').flush({ code: 'WEBPAY_STATUS_UNAVAILABLE' },
      { status: 503, statusText: 'Unavailable' });
    await turno();
    expect(fixture.componentInstance.pendiente()).toBe(paymentId);
    fixture.destroy();
    snapshot.queryParamMap = convertToParamMap({});

    const resumed = TestBed.createComponent(WebpayComponent);
    resumed.detectChanges();
    const estadoUrl = `/api/pagos/webpay/${paymentId}/estado`;
    http.expectOne(estadoUrl).flush(pagoAprobado);
    await turno();
    const first = http.expectOne('/api/orden/confirmar-pago');
    first.flush(null, { status: 503, statusText: 'Unavailable' });
    await turno();
    expect(resumed.componentInstance.mensaje()).toContain('Falta confirmar el pedido');

    const retry = resumed.componentInstance.retomar();
    http.expectOne(estadoUrl).flush(pagoAprobado);
    await turno();
    const confirm = http.expectOne('/api/orden/confirmar-pago');
    expect(confirm.request.headers.get('Idempotency-Key')).toBe(first.request.headers.get('Idempotency-Key'));
    confirm.flush({ pedidoId: 31, pagoId: paymentId, total: 12990, simulacion: false });
    await retry;
    expect(resumed.componentInstance.pedido()).toBe(31);
    http.expectNone('/api/pagos/webpay');
    http.verify();
  });

  it('automatically confirms the same payment after an initially pending return', async () => {
    vi.useFakeTimers();
    const { fixture, http } = setup();
    http.expectOne('/api/pagos/webpay/retorno').flush({ ...pagoAprobado, estado: 'PENDING' });
    await vi.advanceTimersByTimeAsync(1000);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Verificando pago');
    http.expectNone('/api/orden/confirmar-pago');
    http.expectNone(`/api/pagos/webpay/${paymentId}/estado`);

    await vi.advanceTimersByTimeAsync(500);
    http.expectOne(`/api/pagos/webpay/${paymentId}/estado`).flush(pagoAprobado);
    await vi.advanceTimersByTimeAsync(0);
    const confirm = http.expectOne('/api/orden/confirmar-pago');
    expect(confirm.request.body).toEqual({ pagoId: paymentId, operacionId: 'op-1' });
    confirm.flush({ pedidoId: 31, pagoId: paymentId, total: 12990, simulacion: false });
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#webpay-receipt').textContent).toContain('Pago efectuado');
    http.expectNone('/api/pagos/webpay');
    http.verify();
  });

  it('offers a manual check after three automatic checks of a still-pending attempt', async () => {
    vi.useFakeTimers();
    const { fixture, http } = setup();
    const pendiente = { ...pagoAprobado, estado: 'PENDING' };
    http.expectOne('/api/pagos/webpay/retorno').flush(pendiente);
    for (const delay of [1500, 3000, 5000]) {
      await vi.advanceTimersByTimeAsync(delay);
      http.expectOne(`/api/pagos/webpay/${paymentId}/estado`).flush(pendiente);
    }
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#webpay-receipt')).toBeNull();
    expect(fixture.nativeElement.querySelector('button').textContent).toContain('Verificar el mismo pago');
    expect(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT)).toBe(paymentId);
    http.expectNone('/api/orden/confirmar-pago');
    http.verify();
  });

  it('allows returning to checkout after server expiration without starting a second charge', async () => {
    sessionStorage.setItem(WEBPAY_PENDING_PAYMENT, paymentId);
    const { fixture, http } = setup();
    http.expectOne('/api/pagos/webpay/retorno').flush({ ...pagoAprobado, estado: 'EXPIRED' });
    await turno();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#webpay-receipt')).toBeNull();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/checkout"]').textContent).toContain('Volver al checkout');
    expect(fixture.componentInstance.mensaje()).toContain('venció');
    expect(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT)).toBeNull();
    http.expectNone('/api/orden/confirmar-pago');
    http.expectNone('/api/pagos/webpay');
    http.verify();
  });
});
