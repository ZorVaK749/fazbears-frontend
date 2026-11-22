import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { API_BASE_URL } from '../../core/api.config';
import { CarritoService } from '../../core/services/carrito.service';
import { WebpayComponent } from './webpay.component';
import { WEBPAY_PENDING_PAYMENT } from './webpay-session';

describe('Webpay integration return', () => {
  const paymentId = '42ff2362-6631-4a0b-9ba2-07d1193fa61d';

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.removeItem(WEBPAY_PENDING_PAYMENT);
  });

  const turno = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  function setup(fragment: string | null = null) {
    const snapshot = { fragment, queryParamMap: convertToParamMap(fragment ? {} : { token_ws: 'provider-reference-for-test' }) };
    TestBed.configureTestingModule({
      imports: [WebpayComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: CarritoService, useValue: {} },
        { provide: ActivatedRoute, useValue: { snapshot } },
      ],
    });
    const fixture = TestBed.createComponent(WebpayComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectNone('/api/pagos/webpay/capacidad');
    return { fixture, http, snapshot };
  }

  const pagoAprobado = { pagoId: paymentId, operacionId: 'op-1', estado: 'APPROVED', importe: 12990,
    moneda: 'CLP', simulacion: false };

  it('reconciles a cancelled form return without confirming an order', async () => {
    const { fixture, http } = setup('TBK_TOKEN=cancelled-test-reference&TBK_ORDEN_COMPRA=test-order&TBK_ID_SESION=test-session');
    const verify = http.expectOne('/api/pagos/webpay/retorno');
    expect(verify.request.body).toEqual({ tokenWs: null, tbkToken: 'cancelled-test-reference',
      buyOrder: 'test-order', sessionId: 'test-session' });
    verify.flush({ ...pagoAprobado, estado: 'DECLINED' });
    await turno();
    expect(fixture.componentInstance.cerrado()).toBe(true);
    http.expectNone('/api/orden/confirmar-pago');
    http.verify();
  });

  it('requests order confirmation only after server approval of the provider return', async () => {
    const { fixture, http } = setup();
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
    confirm.flush({ pedidoId: 31, pagoId: paymentId, total: 12990, simulacion: false });
    await turno();
    fixture.detectChanges();
    expect(fixture.componentInstance.pedido()).toBe(31);
    expect(fixture.nativeElement.querySelector('#webpay-receipt').textContent).toContain('Pago efectuado');
    expect(fixture.nativeElement.querySelector('.receipt').textContent).toContain('Pedido #31');
    expect(fixture.nativeElement.querySelector('.receipt a[href="/checkout"]').textContent).toContain('Volver al checkout');
    expect(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT)).toBeNull();
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
