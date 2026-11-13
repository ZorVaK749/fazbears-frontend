import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo } from '@azure/msal-browser';
import { vi } from 'vitest';
import { CarritoService } from '../../core/services/carrito.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { FazcoinsComponent } from '../../shared/fazcoins/fazcoins.component';
import { CheckoutComponent } from './checkout.component';
import { AZURE_TENANT_ID } from '../../core/auth/auth.config';

@Component({ selector: 'app-navbar', standalone: true, template: '' }) class NavbarStub {}
@Component({ selector: 'app-fazcoins', standalone: true, template: '' }) class WalletStub {}
const API = 'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api';
const BASE = `${API}/carrito`;
const turno = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const account = (uid: string): AccountInfo => ({ localAccountId: uid, homeAccountId: uid,
  tenantId: 'test', environment: 'login.microsoftonline.com', username: `${uid}@example.com` });
const dto = (uid = 'a', cantidad = 1) => ({ usuarioId: uid, items: cantidad ? [
  { id: 55, productoId: 7, nombreProducto: 'Pizza', cantidad, precioUnitario: 12.99 },
] : [] });
const quote = (ownerId = 'a', importe = 12.99) => ({ operacionId: 'op-1', ownerId,
  tenantId: AZURE_TENANT_ID, importe, moneda: 'CLP', expiraEn: '2030-01-01T00:00:00Z' });
const payment = (estado = 'APPROVED', importe = 12.99) => ({ pagoId: 'pay-1', operacionId: 'op-1',
  estado, importe, moneda: 'CLP', simulacion: true, creadoEn: '2026-01-01T00:00:00Z' });
const result = { pedidoId: 42, mensaje: 'OK', estado: 'PAGADO', total: 12.99, pagoId: 'pay-1', simulacion: true };

describe('Checkout: synchronized owner-bound quote / simulated payment / order', () => {
  let http: HttpTestingController;
  let carrito: CarritoService;
  let activa: AccountInfo;
  beforeEach(async () => {
    activa = account('a');
    await TestBed.configureTestingModule({ imports: [CheckoutComponent], providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: MsalService, useValue: { instance: {
        getActiveAccount: () => activa, getAllAccounts: () => [activa],
      } } },
    ] }).overrideComponent(CheckoutComponent, {
      remove: { imports: [NavbarComponent, FazcoinsComponent] }, add: { imports: [NavbarStub, WalletStub] },
    }).compileComponents();
    http = TestBed.inject(HttpTestingController); carrito = TestBed.inject(CarritoService);
  });
  afterEach(() => http.verify());
  function create() { const f = TestBed.createComponent(CheckoutComponent); f.detectChanges(); return f; }
  async function identidad(uid = 'a') {
    http.expectOne(`${BASE}/me`).flush({ usuarioId: uid, tenantId: AZURE_TENANT_ID }); await turno();
  }
  async function cargar() {
    const carga = carrito.inicializar(); await turno(); await identidad();
    http.expectOne(`${BASE}/a`).flush(dto()); await carga;
  }
  async function cotizar(owner = 'a', importe = 12.99) {
    const req = http.expectOne(`${API}/orden/cotizaciones`);
    expect(req.request.body).toEqual({ items: [{ productoId: 7, cantidad: importe === 25.98 ? 2 : 1 }] });
    expect(req.request.headers.get('Idempotency-Key')).toBeTruthy();
    req.flush(quote(owner, importe)); await turno();
  }
  async function aprobar(importe = 12.99) {
    const req = http.expectOne(`${API}/pagos`);
    expect(req.request.body).toEqual({ operacionId: 'op-1', metodo: 'SIMULADO', instrumentoPruebaId: 'sim-approved' });
    req.flush(payment('APPROVED', importe), { status: 201, statusText: 'Created' }); await turno();
  }

  it('waits for GET and POST, ignores duplicate click, and clears only after approved payment AND confirmation', async () => {
    const f = create();
    carrito.agregarProducto({ id: 7, nombre: 'Pizza', descripcion: '', precio: 12.99, categoria: 'PIZZA' });
    const espera = f.componentInstance.procesarPago(); await f.componentInstance.procesarPago(); await turno();
    http.expectNone(`${API}/orden/cotizaciones`); await identidad();
    http.expectOne(`${BASE}/a`).flush(dto()); await turno();
    http.expectNone(`${API}/orden/cotizaciones`);
    http.expectOne(`${BASE}/a/items`).flush(dto('a', 2)); await turno();
    await cotizar('a', 25.98); await aprobar(25.98);
    expect(carrito.cantidadItems).toBe(2);
    const confirm = http.expectOne(`${API}/orden/confirmar-pago`);
    expect(confirm.request.body).toEqual({ operacionId: 'op-1', pagoId: 'pay-1' });
    confirm.flush({ ...result, total: 25.98 }); await espera; await turno();
    const borrado = http.expectOne(`${BASE}/a`); expect(borrado.request.method).toBe('DELETE'); borrado.flush(dto('a', 0));
    await carrito.sincronizado(); expect(f.componentInstance.pagoExitoso).toBe(true);
  });
  it('does not quote if initial cart recovery fails', async () => {
    const f = create(); const p = f.componentInstance.procesarPago(); await turno(); await identidad();
    http.expectOne(`${BASE}/a`).flush({}, { status: 403, statusText: 'Forbidden' }); await p;
    http.expectNone(`${API}/orden/cotizaciones`); expect(f.componentInstance.procesando).toBe(false);
  });
  it('does not quote after a failed cart write even if revalidation succeeds', async () => {
    await cargar(); const f = create();
    carrito.agregarProducto({ id: 7, nombre: 'Pizza', descripcion: '', precio: 12.99, categoria: 'PIZZA' });
    const p = f.componentInstance.procesarPago(); await turno();
    http.expectOne(`${BASE}/a/items`).flush({}, { status: 500, statusText: 'Error' }); await turno();
    http.expectOne(`${BASE}/a`).flush(dto()); await p;
    http.expectNone(`${API}/orden/cotizaciones`); expect(f.componentInstance.errorMsg).toContain('sincronizar');
  });
  it('account switch while waiting cannot create a quote for either account', async () => {
    const f = create(); const p = f.componentInstance.procesarPago(); await turno(); await identidad();
    const anterior = http.expectOne(`${BASE}/a`); activa = account('b'); const carga = carrito.inicializar();
    expect(anterior.cancelled).toBe(true); await turno(); await identidad('b');
    http.expectOne(`${BASE}/b`).flush(dto('b', 3)); await Promise.all([p, carga]);
    http.expectNone(`${API}/orden/cotizaciones`); expect(carrito.cantidadItems).toBe(3);
  });
  it('late confirmation cannot wipe or show success in a new session', async () => {
    await cargar(); const f = create(); const p = f.componentInstance.procesarPago(); await turno();
    await cotizar(); await aprobar(); const confirm = http.expectOne(`${API}/orden/confirmar-pago`);
    activa = account('b'); const carga = carrito.inicializar(); await turno(); await identidad('b');
    http.expectOne(`${BASE}/b`).flush(dto('b', 3)); await carga;
    confirm.flush(result); await p; http.expectNone(() => true);
    expect(carrito.cantidadItems).toBe(3); expect(f.componentInstance.pagoExitoso).toBe(false);
  });
  it('cart changes after snapshot prevent the initial quote', async () => {
    await cargar(); const f = create(); const snapshot = await carrito.prepararCheckout();
    vi.spyOn(carrito, 'prepararCheckout').mockResolvedValue(snapshot);
    const p = f.componentInstance.procesarPago(); carrito.quitarItem(7); await p;
    http.expectNone(`${API}/orden/cotizaciones`); await turno();
    http.expectOne(`${BASE}/a/items/55`).flush(dto('a', 0)); await carrito.sincronizado();
  });
  it('destroying the component during cart barrier sends no late quote', async () => {
    const f = create(); const p = f.componentInstance.procesarPago(); await turno(); await identidad();
    const carga = http.expectOne(`${BASE}/a`); f.destroy(); carga.flush(dto()); await p;
    http.expectNone(`${API}/orden/cotizaciones`);
  });
  it('uses /me owner for quote validation, never sends browser owner, email or prices', async () => {
    const f = create(); const p = f.componentInstance.procesarPago(); await turno();
    await identidad('backend-owner'); http.expectOne(`${BASE}/backend-owner`).flush(dto('backend-owner')); await turno();
    await cotizar('backend-owner'); const req = http.expectOne(`${API}/pagos`);
    req.flush(payment('DECLINED'), { status: 201, statusText: 'Created' }); await p;
    http.expectNone(`${API}/orden/confirmar-pago`); expect(f.componentInstance.pagoExitoso).toBe(false);
  });
  it('identity failure never falls back to localAccountId', async () => {
    const f = create(); const p = f.componentInstance.procesarPago(); await turno();
    http.expectOne(`${BASE}/me`).flush({}, { status: 404, statusText: 'Not deployed' }); await p;
    http.expectNone(() => true); expect(f.componentInstance.procesando).toBe(false);
  });
  it('keeps quote, payment body and key on explicit 503 retry even if instrument changes', async () => {
    await cargar(); const f = create(); let p = f.componentInstance.procesarPago(); await turno(); await cotizar();
    const req = http.expectOne(`${API}/pagos`); const key = req.request.headers.get('Idempotency-Key');
    req.flush({}, { status: 503, statusText: 'Unavailable' }); await p;
    f.componentInstance.instrumento = 'sim-declined'; p = f.componentInstance.procesarPago(); await turno();
    http.expectNone(`${API}/orden/cotizaciones`); const retry = http.expectOne(`${API}/pagos`);
    expect(retry.request.body).toEqual(req.request.body); expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush(payment('DECLINED')); await p; http.expectNone(`${API}/orden/confirmar-pago`);
  });
  it('BLOCKED 429 response is not success and does not confirm', async () => {
    await cargar(); const f = create(); const p = f.componentInstance.procesarPago(); await turno(); await cotizar();
    http.expectOne(`${API}/pagos`).flush(payment('BLOCKED'), { status: 429, statusText: 'Too Many Requests' }); await p;
    expect(f.componentInstance.errorMsg).toContain('bloqueado'); expect(f.componentInstance.pagoExitoso).toBe(false);
    http.expectNone(`${API}/orden/confirmar-pago`);
  });
  it('does not wipe a newer cart after successful confirmation', async () => {
    await cargar(); const f = create(); const p = f.componentInstance.procesarPago(); await turno(); await cotizar(); await aprobar();
    const confirm = http.expectOne(`${API}/orden/confirmar-pago`);
    carrito.agregarProducto({ id: 7, nombre: 'Pizza', descripcion: '', precio: 12.99, categoria: 'PIZZA' }); await turno();
    http.expectOne(`${BASE}/a/items`).flush(dto('a', 2)); await carrito.sincronizado(); confirm.flush(result); await p;
    http.expectNone(`${BASE}/a`); expect(carrito.cantidadItems).toBe(2);
  });
  it('replays confirmation with its original key after lost response, without another payment', async () => {
    await cargar(); const f = create(); let p = f.componentInstance.procesarPago(); await turno(); await cotizar(); await aprobar();
    const req = http.expectOne(`${API}/orden/confirmar-pago`); req.error(new ProgressEvent('error')); await p;
    p = f.componentInstance.procesarPago(); await turno();
    http.expectNone(`${API}/pagos`); const retry = http.expectOne(`${API}/orden/confirmar-pago`);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(req.request.headers.get('Idempotency-Key'));
    retry.flush(result); await p; await turno(); http.expectOne(`${BASE}/a`).flush(dto('a', 0)); await carrito.sincronizado();
  });
  it('quote 503 retry keeps original key and items even when cart was edited', async () => {
    await cargar(); const f = create(); let p = f.componentInstance.procesarPago(); await turno();
    const req = http.expectOne(`${API}/orden/cotizaciones`); req.flush({}, { status: 503, statusText: 'Unavailable' }); await p;
    carrito.agregarProducto({ id: 7, nombre: 'Pizza', descripcion: '', precio: 12.99, categoria: 'PIZZA' }); await turno();
    http.expectOne(`${BASE}/a/items`).flush(dto('a', 2)); await carrito.sincronizado();
    p = f.componentInstance.procesarPago(); await turno(); const retry = http.expectOne(`${API}/orden/cotizaciones`);
    expect(retry.request.body).toEqual(req.request.body);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(req.request.headers.get('Idempotency-Key'));
    retry.flush(quote()); await turno(); http.expectOne(`${API}/pagos`).flush(payment('DECLINED')); await p;
  });
  it('a foreign quote is never sent to payments', async () => {
    await cargar(); const f = create(); const p = f.componentInstance.procesarPago(); await turno(); await cotizar('someone-else'); await p;
    http.expectNone(`${API}/pagos`); expect(f.componentInstance.errorMsg).toContain('propietario');
  });
  it('switching accounts during payment never confirms the previous payment', async () => {
    await cargar(); const f = create(); const p = f.componentInstance.procesarPago(); await turno(); await cotizar();
    const req = http.expectOne(`${API}/pagos`); activa = account('b'); req.flush(payment()); await p;
    http.expectNone(`${API}/orden/confirmar-pago`); expect(f.componentInstance.pagoExitoso).toBe(false);
  });
  it('does not treat a non-simulated or mismatched payment as approved', async () => {
    await cargar(); const f = create(); const p = f.componentInstance.procesarPago(); await turno(); await cotizar();
    http.expectOne(`${API}/pagos`).flush({ ...payment(), simulacion: false }); await p;
    http.expectNone(`${API}/orden/confirmar-pago`); expect(f.componentInstance.errorMsg).toContain('incompatible');
  });
  it('sim-declined selection is the only payment instrument content and has no bank-data inputs', async () => {
    await cargar(); const f = create(); f.componentInstance.instrumento = 'sim-declined';
    expect(f.nativeElement.querySelectorAll('input').length).toBe(0);
    const p = f.componentInstance.procesarPago(); await turno(); await cotizar();
    const req = http.expectOne(`${API}/pagos`);
    expect(req.request.body).toEqual({ operacionId: 'op-1', metodo: 'SIMULADO', instrumentoPruebaId: 'sim-declined' });
    req.flush(payment('DECLINED'), { status: 201, statusText: 'Created' }); await p;
    expect(f.componentInstance.pagoExitoso).toBe(false); expect(carrito.cantidadItems).toBe(1);
  });
});
