import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api.config';
import { CarritoService } from '../../core/services/carrito.service';
import { WebpayComponent } from './webpay.component';

describe('Webpay integration return', () => {
  const paymentId = '42ff2362-6631-4a0b-9ba2-07d1193fa61d';

  afterEach(() => sessionStorage.removeItem('pedidos360.webpay.paymentId'));

  it('requests order confirmation only after server approval of the provider return', async () => {
    TestBed.configureTestingModule({
      imports: [WebpayComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: CarritoService, useValue: {} },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({
          token_ws: 'provider-reference-for-test',
        }) } } },
      ],
    });
    const fixture = TestBed.createComponent(WebpayComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne('/api/pagos/webpay/capacidad').flush(null);
    await Promise.resolve();
    const verify = http.expectOne('/api/pagos/webpay/retorno');
    expect(verify.request.body.tokenWs).toBe('provider-reference-for-test');
    http.expectNone('/api/orden/confirmar-pago');
    verify.flush({ pagoId: paymentId, operacionId: 'op-1', estado: 'APPROVED', importe: 12990,
      moneda: 'CLP', simulacion: false });
    await Promise.resolve();
    const confirm = http.expectOne('/api/orden/confirmar-pago');
    expect(confirm.request.headers.get('Idempotency-Key')).toBe(`webpay-${paymentId}`);
    confirm.flush({ pedidoId: 31, pagoId: paymentId, total: 12990, simulacion: false });
    await Promise.resolve();
    expect(fixture.componentInstance.pedido()).toBe(31);
    expect(sessionStorage.getItem('pedidos360.webpay.paymentId')).toBeNull();
    http.verify();
  });
});
