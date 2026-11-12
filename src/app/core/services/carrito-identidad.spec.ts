import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo } from '@azure/msal-browser';
import { vi } from 'vitest';
import { AZURE_TENANT_ID } from '../auth/auth.config';
import { CarritoService } from './carrito.service';
import { Producto } from './producto.service';

const BASE = 'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api/carrito';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const turno = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const account = (id: string): AccountInfo => ({ localAccountId: `cache-local-${id}`,
  homeAccountId: `home-${id}`, tenantId: 'home-tenant-not-resource-tenant',
  environment: 'login.microsoftonline.com', username: `${id}@example.com` });
const identity = (usuarioId = A) => ({ usuarioId, tenantId: AZURE_TENANT_ID });
const cart = (usuarioId = A, cantidad = 1) => ({ usuarioId, items: [{ id: 55,
  productoId: 7, nombreProducto: 'Pizza', precioUnitario: 10, cantidad }] });
const producto: Producto = { id: 7, nombre: 'Pizza', precio: 10, descripcion: '', categoria: 'PIZZA' };

describe('Contrato /me: identidad del recurso y aislamiento asíncrono', () => {
  let service: CarritoService;
  let http: HttpTestingController;
  let active: AccountInfo | null;
  beforeEach(() => {
    active = account('a');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: MsalService, useValue: { instance: { getActiveAccount: () => active,
        getAllAccounts: () => active ? [active] : [] } } },
    ] });
    service = TestBed.inject(CarritoService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  async function cargar(uid = A) {
    const init = service.inicializar();
    await turno(); http.expectOne(`${BASE}/me`).flush(identity(uid));
    await turno(); http.expectOne(`${BASE}/${uid}`).flush(cart(uid));
    await init;
  }

  it('espera identidad backend antes de GET/POST y nunca usa localAccountId como propietario', async () => {
    service.agregarProducto(producto);
    await turno();
    const me = http.expectOne(`${BASE}/me`);
    expect(me.request.method).toBe('GET');
    expect(me.request.params.keys()).toEqual([]);
    http.expectNone(request => request.url !== `${BASE}/me`);
    expect(service.sincronizando()).toBe(true);
    me.flush(identity());
    await turno(); http.expectOne(`${BASE}/${A}`).flush(cart());
    await turno();
    const post = http.expectOne(`${BASE}/${A}/items`);
    expect(post.request.method).toBe('POST');
    post.flush(cart(A, 2));
    const snapshot = await service.prepararCheckout();
    expect(snapshot.usuarioId).toBe(A);
    expect(snapshot.tenantId).toBe(AZURE_TENANT_ID);
    expect(snapshot.usuarioId).not.toBe(active?.localAccountId);
  });

  it('inicializaciones y refresh simultáneos comparten un único /me', async () => {
    const uno = service.inicializar(), dos = service.inicializar(), tres = service.recargar();
    await turno(); http.expectOne(`${BASE}/me`).flush(identity());
    await turno(); http.expectOne(`${BASE}/${A}`).flush(cart());
    await Promise.all([uno, dos, tres]);
    await service.inicializar(); http.expectNone(() => true);
  });

  it('mantiene identidad solo en la sesión; refresh de carrito no depende del cache MSAL', async () => {
    await cargar();
    const refresh = service.recargar();
    await turno(); http.expectOne(`${BASE}/${A}`).flush(cart());
    await refresh; http.expectNone(`${BASE}/me`);
    expect((await service.prepararCheckout()).usuarioId).toBe(A);
  });

  it('cambio de cuenta cancela /me anterior y descarta escrituras dependientes', async () => {
    service.agregarProducto(producto);
    await turno(); const old = http.expectOne(`${BASE}/me`);
    active = account('b'); const init = service.inicializar();
    expect(old.cancelled).toBe(true);
    expect(() => old.flush(identity())).toThrow();
    await turno(); http.expectOne(`${BASE}/me`).flush(identity(B));
    await turno(); http.expectOne(`${BASE}/${B}`).flush(cart(B, 3));
    await init;
    http.expectNone(`${BASE}/${A}`);
    http.expectNone(request => request.method !== 'GET');
    expect((await service.prepararCheckout()).usuarioId).toBe(B);
  });

  it('respuesta /me ya entregada pero pendiente de continuación no puede activar otra sesión', async () => {
    const oldInit = service.inicializar();
    await turno(); http.expectOne(`${BASE}/me`).flush(identity());
    // Cambiar antes de que continúe el await de la respuesta A.
    active = account('b'); const newInit = service.inicializar();
    await turno(); http.expectNone(`${BASE}/${A}`);
    http.expectOne(`${BASE}/me`).flush(identity(B));
    await turno(); http.expectOne(`${BASE}/${B}`).flush(cart(B));
    await Promise.all([oldInit, newInit]);
    expect((await service.prepararCheckout()).usuarioId).toBe(B);
    expect(service.errorSincronizacion()).toBe('');
  });

  it('logout inmediatamente después de /me descarta la continuación sin HTTP adicional', async () => {
    const init = service.inicializar();
    await turno(); http.expectOne(`${BASE}/me`).flush(identity());
    active = null; service.cerrarSesion();
    await init;
    http.expectNone(() => true);
    expect(service.cantidadItems).toBe(0);
    expect(service.sincronizando()).toBe(false);
  });

  it.each([401, 403, 404, 503])('/me HTTP %s bloquea carga, escrituras y checkout sin fallback', async status => {
    service.agregarProducto(producto);
    await turno(); http.expectOne(`${BASE}/me`).flush({}, { status, statusText: 'Error controlado' });
    expect(await service.sincronizado()).toBe(false);
    await expect(service.prepararCheckout()).rejects.toThrow('sincronizar');
    service.agregarProducto(producto);
    await turno(); http.expectNone(() => true);
    expect(service.errorSincronizacion()).toContain('ACTUALIZAR');
  });

  it('ACTUALIZAR recupera identidad tras error sin reenviar la mutación cancelada', async () => {
    service.agregarProducto(producto);
    await turno(); http.expectOne(`${BASE}/me`).error(new ProgressEvent('error'));
    expect(await service.sincronizado()).toBe(false);
    const refresh = service.recargar();
    await turno(); http.expectOne(`${BASE}/me`).flush(identity());
    await turno(); http.expectOne(`${BASE}/${A}`).flush(cart());
    await refresh;
    expect(await service.sincronizado()).toBe(true);
    http.expectNone(request => request.method !== 'GET');
  });

  it.each([
    null, {}, { usuarioId: '', tenantId: AZURE_TENANT_ID },
    { usuarioId: 42, tenantId: AZURE_TENANT_ID },
    { usuarioId: 'me', tenantId: AZURE_TENANT_ID },
    { usuarioId: '../otro', tenantId: AZURE_TENANT_ID },
    { usuarioId: A }, { usuarioId: A, tenantId: 'another-tenant' },
  ])('rechaza identidad malformada o de tenant incorrecto: %j', async dto => {
    const init = service.inicializar();
    await turno(); http.expectOne(`${BASE}/me`).flush(dto);
    await init;
    expect(await service.sincronizado()).toBe(false);
    http.expectNone(() => true);
    expect(service.carrito().items).toEqual([]);
  });

  it('timeout /me cancela la solicitud y no carga carrito ni reintenta automáticamente', async () => {
    vi.useFakeTimers();
    const init = service.inicializar();
    await vi.advanceTimersByTimeAsync(0);
    const me = http.expectOne(`${BASE}/me`);
    await vi.advanceTimersByTimeAsync(15001);
    await init;
    expect(me.cancelled).toBe(true);
    expect(await service.sincronizado()).toBe(false);
    http.expectNone(() => true);
  });

  it('snapshot de A no es utilizable ni borra datos tras resolver /me de B', async () => {
    await cargar(); const snapshot = await service.prepararCheckout();
    active = account('b'); await cargar(B);
    expect(service.snapshotVigente(snapshot)).toBe(false);
    service.limpiarTrasCompra(snapshot);
    http.expectNone(() => true);
    expect((await service.prepararCheckout()).usuarioId).toBe(B);
  });
});
