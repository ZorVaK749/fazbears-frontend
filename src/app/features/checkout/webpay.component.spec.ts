import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api.config';
import { CarritoService } from '../../core/services/carrito.service';
import { WebpayComponent } from './webpay.component';
import { WEBPAY_PENDING_PAYMENT } from './webpay-session';

describe('Webpay integration return', () => {
  const paymentId = '42ff2362-6631-4a0b-9ba2-07d1193fa61d';

  afterEach(() => sessionStorage.removeItem(WEBPAY_PENDING_PAYMENT));

  function setup() {
    const snapshot = { queryParamMap: convertToParamMap({ token_ws: 'provider-reference-for-test' }) };
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

  it('requests order confirmation only after server approval of the provider return', async () => {
    const { fixture, http } = setup();
    const verify = http.expectOne('/api/pagos/webpay/retorno');
    expect(verify.request.body.tokenWs).toBe('provider-reference-for-test');
    http.expectNone('/api/orden/confirmar-pago');
    verify.flush(pagoAprobado);
    await Promise.resolve();
    const confirm = http.expectOne('/api/orden/confirmar-pago');
    expect(confirm.request.headers.get('Idempotency-Key')).toBe(`webpay-${paymentId}`);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#webpay-receipt')).toBeNull();
    confirm.flush({ pedidoId: 31, pagoId: paymentId, total: 12990, simulacion: false });
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.componentInstance.pedido()).toBe(31);
    expect(fixture.nativeElement.querySelector('#webpay-receipt').textContent).toContain('Pago efectuado');
    expect(fixture.nativeElement.querySelector('.receipt').textContent).toContain('pedido #31');
    expect(fixture.nativeElement.querySelector('.receipt a[href="/checkout"]').textContent).toContain('Volver al checkout');
    expect(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT)).toBeNull();
    http.verify();
  });

  it('resumes the same payment after a failed return and after a failed order confirmation', async () => {
    sessionStorage.setItem(WEBPAY_PENDING_PAYMENT, paymentId);
    const { fixture, http, snapshot } = setup();
    http.expectOne('/api/pagos/webpay/retorno').flush({ code: 'WEBPAY_STATUS_UNAVAILABLE' },
      { status: 503, statusText: 'Unavailable' });
    await Promise.resolve();
    expect(fixture.componentInstance.pendiente()).toBe(paymentId);
    fixture.destroy();
    snapshot.queryParamMap = convertToParamMap({});

    const resumed = TestBed.createComponent(WebpayComponent);
    resumed.detectChanges();
    const estadoUrl = `/api/pagos/webpay/${paymentId}/estado`;
    http.expectOne(estadoUrl).flush(pagoAprobado);
    await Promise.resolve();
    const first = http.expectOne('/api/orden/confirmar-pago');
    first.flush(null, { status: 503, statusText: 'Unavailable' });
    await Promise.resolve();
    expect(resumed.componentInstance.mensaje()).toContain('Falta confirmar el pedido');

    const retry = resumed.componentInstance.retomar();
    http.expectOne(estadoUrl).flush(pagoAprobado);
    await Promise.resolve();
    const confirm = http.expectOne('/api/orden/confirmar-pago');
    expect(confirm.request.headers.get('Idempotency-Key')).toBe(first.request.headers.get('Idempotency-Key'));
    confirm.flush({ pedidoId: 31, pagoId: paymentId, total: 12990, simulacion: false });
    await retry;
    expect(resumed.componentInstance.pedido()).toBe(31);
    http.expectNone('/api/pagos/webpay');
    http.verify();
  });

  it('keeps the same payment blocked when the provider still reports a pending attempt', async () => {
    const { fixture, http } = setup();
    http.expectOne('/api/pagos/webpay/retorno').flush({ ...pagoAprobado, estado: 'PENDING' });
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#webpay-receipt')).toBeNull();
    expect(fixture.nativeElement.querySelector('button').textContent).toContain('Verificar el mismo pago');
    expect(sessionStorage.getItem(WEBPAY_PENDING_PAYMENT)).toBe(paymentId);
    http.expectNone('/api/orden/confirmar-pago');
    http.verify();
  });
});
