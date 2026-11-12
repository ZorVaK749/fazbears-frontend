import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo } from '@azure/msal-browser';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { CarritoService } from '../../core/services/carrito.service';
import { OrdenResponse, OrdenService } from '../../core/services/orden.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { CheckoutComponent } from './checkout.component';
import { AZURE_TENANT_ID } from '../../core/auth/auth.config';

@Component({ selector: 'app-navbar', standalone: true, template: '' })
class NavbarStub {}

const BASE = 'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api/carrito';
const turno = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const account = (uid: string): AccountInfo => ({ localAccountId: uid, homeAccountId: uid,
  tenantId: 'test', environment: 'login.microsoftonline.com', username: `${uid}@example.com` });
const dto = (uid = 'a', cantidad = 1) => ({ usuarioId: uid, items: cantidad ? [
  { id: 55, productoId: 7, nombreProducto: 'Pizza', cantidad, precioUnitario: 12.99 },
] : [] });

describe('Checkout: only cart synchronization boundary, no real orders', () => {
  let http: HttpTestingController;
  let carrito: CarritoService;
  let activa: AccountInfo;
  let confirmar: ReturnType<typeof vi.fn>;
  let response: Subject<OrdenResponse>;
  beforeEach(async () => {
    activa = account('a'); response = new Subject<OrdenResponse>();
    confirmar = vi.fn(() => response.asObservable());
    await TestBed.configureTestingModule({ imports: [CheckoutComponent], providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: MsalService, useValue: { instance: {
        getActiveAccount: () => activa, getAllAccounts: () => [activa],
      } } },
      { provide: OrdenService, useValue: { confirmar } },
    ] }).overrideComponent(CheckoutComponent, {
      remove: { imports: [NavbarComponent] }, add: { imports: [NavbarStub] },
    }).compileComponents();
    http = TestBed.inject(HttpTestingController); carrito = TestBed.inject(CarritoService);
  });
  afterEach(() => http.verify());

  function create() {
    const fixture = TestBed.createComponent(CheckoutComponent);
    fixture.componentInstance.metodoSeleccionado = 'EFECTIVO'; fixture.detectChanges();
    return fixture;
  }
  async function identidad(uid = 'a') {
    http.expectOne(`${BASE}/me`).flush({ usuarioId: uid, tenantId: AZURE_TENANT_ID });
    await turno();
  }
  async function cargar() {
    const carga = carrito.inicializar(); await turno();
    await identidad();
    http.expectOne(`${BASE}/a`).flush(dto()); await carga;
  }

  it('waits for GET and POST before confirming exactly one order with the confirmed snapshot', async () => {
    const fixture = create();
    carrito.agregarProducto({ id: 7, nombre: 'Pizza', descripcion: '', precio: 12.99, categoria: 'PIZZA' });
    const espera = fixture.componentInstance.procesarPago();
    await fixture.componentInstance.procesarPago(); // duplicate click during the barrier
    await turno();
    expect(confirmar).not.toHaveBeenCalled();
    await identidad();
    http.expectOne(`${BASE}/a`).flush(dto());
    await turno();
    expect(confirmar).not.toHaveBeenCalled();
    http.expectOne(`${BASE}/a/items`).flush(dto('a', 2));
    await espera;
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][0]).toEqual({ usuarioId: 'a', emailUsuario: 'a@example.com',
      items: [{ productoId: 7, nombreProducto: 'Pizza', cantidad: 2, precioUnitario: 12.99 }] });
    response.next({ pedidoId: 42, mensaje: 'OK', estado: 'PENDIENTE', total: 25.98 });
    await turno();
    const borrado = http.expectOne(`${BASE}/a`);
    expect(borrado.request.method).toBe('DELETE');
    borrado.flush(dto('a', 0));
    await carrito.sincronizado();
    expect(carrito.cantidadItems).toBe(0);
  });

  it('does not confirm if the initial cart could not be recovered', async () => {
    const fixture = create();
    const espera = fixture.componentInstance.procesarPago();
    await turno();
    await identidad();
    http.expectOne(`${BASE}/a`).flush({}, { status: 403, statusText: 'Forbidden' });
    await espera; await fixture.whenStable();
    expect(confirmar).not.toHaveBeenCalled();
    expect(fixture.componentInstance.procesando).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('¡PAGO APROBADO');
  });

  it('does not confirm after a failed write even when revalidation GET succeeds', async () => {
    await cargar(); const fixture = create();
    carrito.agregarProducto({ id: 7, nombre: 'Pizza', descripcion: '', precio: 12.99, categoria: 'PIZZA' });
    const espera = fixture.componentInstance.procesarPago();
    await turno();
    http.expectOne(`${BASE}/a/items`).flush({}, { status: 500, statusText: 'Error' });
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto());
    await espera;
    expect(confirmar).not.toHaveBeenCalled();
    expect(fixture.componentInstance.errorMsg).toContain('sincronizar');
  });

  it('switching accounts while waiting does not create an order for either account', async () => {
    const fixture = create();
    const espera = fixture.componentInstance.procesarPago();
    await turno();
    await identidad();
    const anterior = http.expectOne(`${BASE}/a`);
    activa = account('b'); const carga = carrito.inicializar();
    expect(anterior.cancelled).toBe(true);
    await turno(); await identidad('b'); http.expectOne(`${BASE}/b`).flush(dto('b', 3));
    await Promise.all([espera, carga]);
    expect(confirmar).not.toHaveBeenCalled();
    expect(carrito.cantidadItems).toBe(3);
  });

  it('a late order result from the previous account never deletes the new account cart', async () => {
    await cargar(); const fixture = create();
    await fixture.componentInstance.procesarPago();
    expect(confirmar).toHaveBeenCalledTimes(1);
    activa = account('b'); const carga = carrito.inicializar();
    await turno(); await identidad('b'); http.expectOne(`${BASE}/b`).flush(dto('b', 3)); await carga;
    response.next({ pedidoId: 42, mensaje: 'OK', estado: 'PENDIENTE', total: 12.99 });
    await turno();
    http.expectNone(() => true);
    expect(carrito.cantidadItems).toBe(3);
    expect(fixture.componentInstance.pagoExitoso).toBe(false);
  });

  it('does not send an order if cart changes after the barrier produced its snapshot', async () => {
    await cargar(); const fixture = create();
    const snapshot = await carrito.prepararCheckout();
    vi.spyOn(carrito, 'prepararCheckout').mockResolvedValue(snapshot);
    const espera = fixture.componentInstance.procesarPago();
    carrito.quitarItem(7);
    await espera;
    expect(confirmar).not.toHaveBeenCalled();
    await turno(); http.expectOne(`${BASE}/a/items/55`).flush(dto('a', 0));
    await carrito.sincronizado();
  });

  it('leaving the component while waiting does not send a late order', async () => {
    const fixture = create();
    const espera = fixture.componentInstance.procesarPago();
    await turno(); await identidad(); const carga = http.expectOne(`${BASE}/a`);
    fixture.destroy(); carga.flush(dto());
    await espera;
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('waits for /me and propagates the backend owner to Orden even when localAccountId differs', async () => {
    const fixture = create();
    const espera = fixture.componentInstance.procesarPago();
    await turno();
    expect(confirmar).not.toHaveBeenCalled();
    const oid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    http.expectOne(`${BASE}/me`).flush({ usuarioId: oid, tenantId: AZURE_TENANT_ID });
    await turno();
    expect(confirmar).not.toHaveBeenCalled();
    http.expectOne(`${BASE}/${oid}`).flush(dto(oid, 2));
    await espera;
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][0].usuarioId).toBe(oid);
    expect(confirmar.mock.calls[0][0].usuarioId).not.toBe(activa.localAccountId);
    expect(confirmar.mock.calls[0][0]).not.toHaveProperty('tenantId');
  });

  it('identity endpoint failure never sends an order or falls back to localAccountId', async () => {
    const fixture = create();
    const espera = fixture.componentInstance.procesarPago();
    await turno(); http.expectOne(`${BASE}/me`).flush({}, { status: 404, statusText: 'Not deployed' });
    await espera;
    expect(confirmar).not.toHaveBeenCalled();
    http.expectNone(() => true);
    expect(fixture.componentInstance.procesando).toBe(false);
  });
});
