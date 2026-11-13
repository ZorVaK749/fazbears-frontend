import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo } from '@azure/msal-browser';
import { vi } from 'vitest';
import { AZURE_TENANT_ID } from '../../core/auth/auth.config';
import { CarritoService } from '../../core/services/carrito.service';
import { MisPedidosService } from '../../core/services/mis-pedidos.service';
import { Pedido } from '../../core/services/pedido.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { CarritoComponent } from '../cart/carrito.component';
import { PerfilComponent } from '../perfil/perfil.component';
import { ReportesComponent } from '../reportes/reportes.component';
import { OrdersComponent } from './orders.component';
import { FazcoinsComponent } from '../../shared/fazcoins/fazcoins.component';

@Component({ selector: 'app-navbar', standalone: true, template: '' }) class NavbarStub {}
@Component({ selector: 'app-carrito', standalone: true, template: '' }) class CartStub {}
@Component({ selector: 'app-fazcoins', standalone: true, template: '' }) class WalletStub {}
const API = 'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const turno = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const account = (uid: string): AccountInfo => ({ localAccountId: `cache-${uid}`, homeAccountId: uid,
  tenantId: 'home-tenant', environment: 'login.microsoftonline.com', username: 'vic.placencia@duocuc.cl' });
const pedido = (owner = A, id = 1): Pedido => ({ id, usuarioId: owner,
  emailUsuario: 'fixture@example.com', estado: 'PENDIENTE', total: 10,
  items: [{ productoId: 7, nombreProducto: 'Pizza', cantidad: 1, precioUnitario: 10 }] });

describe('Perfil e Historial: identidad backend y pedidos propios compartidos', () => {
  let http: HttpTestingController;
  let carrito: CarritoService;
  let pedidos: MisPedidosService;
  let active: AccountInfo | null;
  let logout: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    active = account('a'); logout = vi.fn();
    await TestBed.configureTestingModule({ imports: [PerfilComponent, OrdersComponent, ReportesComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: MsalService, useValue: { instance: { getActiveAccount: () => active,
          getAllAccounts: () => active ? [active] : [] }, logoutRedirect: logout } },
      ],
    }).overrideComponent(PerfilComponent, { remove: { imports: [NavbarComponent, FazcoinsComponent] }, add: { imports: [NavbarStub, WalletStub] } })
      .overrideComponent(OrdersComponent, { remove: { imports: [NavbarComponent, CarritoComponent] },
        add: { imports: [NavbarStub, CartStub] } })
      .overrideComponent(ReportesComponent, { remove: { imports: [NavbarComponent] }, add: { imports: [NavbarStub] } })
      .compileComponents();
    http = TestBed.inject(HttpTestingController); carrito = TestBed.inject(CarritoService);
    pedidos = TestBed.inject(MisPedidosService);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  function createBoth() {
    const perfil = TestBed.createComponent(PerfilComponent), orders = TestBed.createComponent(OrdersComponent);
    perfil.detectChanges(); orders.detectChanges();
    return { perfil, orders };
  }
  async function identity(owner = A) {
    await turno(); http.expectOne(`${API}/carrito/me`).flush({ usuarioId: owner, tenantId: AZURE_TENANT_ID });
    await turno(); TestBed.tick();
    http.expectOne(`${API}/carrito/${owner}`).flush({ usuarioId: owner, items: [] });
    await turno(); TestBed.tick();
  }
  async function load(owner = A) {
    await identity(owner);
    http.expectOne(`${API}/pedidos/usuario/${owner}`).flush([pedido(owner)]);
    await turno(); TestBed.tick();
  }

  it('carga Perfil e Historial con un /me y un GET propio, nunca listado global o localAccountId', async () => {
    const { perfil, orders } = createBoth();
    await load();
    expect(perfil.componentInstance.usuarioId).toBe(A);
    expect(perfil.componentInstance.misPedidos).toEqual([pedido()]);
    expect(orders.componentInstance.pedidosFiltrados).toEqual([pedido()]);
    expect(perfil.componentInstance.totalGastado).toBe(10);
    expect(perfil.componentInstance.esAdmin).toBe(false);
    expect(orders.componentInstance.esAdmin).toBe(false);
    http.expectNone(`${API}/pedidos`);
    http.expectNone(`${API}/pedidos/usuario/cache-a`);
    await perfil.whenStable(); await orders.whenStable();
    expect(perfil.nativeElement.textContent).toContain(A);
    expect(orders.nativeElement.querySelector('#btn-cancelar-1')).not.toBeNull();
    expect(orders.nativeElement.querySelector('#btn-preparar-1')).toBeNull();
  });

  it('si carrito ya resolvió identidad, las pantallas no duplican /me ni GET carrito', async () => {
    const init = carrito.inicializar(); await identity(); await init;
    createBoth(); await turno(); TestBed.tick();
    http.expectOne(`${API}/pedidos/usuario/${A}`).flush([pedido()]);
    http.expectNone(`${API}/carrito/me`);
    http.expectNone(`${API}/carrito/${A}`);
  });

  it('cambio de cuenta vacía datos y cancela consulta de A antes de consultar B', async () => {
    const { perfil, orders } = createBoth(); await identity();
    const old = http.expectOne(`${API}/pedidos/usuario/${A}`);
    active = account('b'); const init = carrito.inicializar();
    TestBed.tick(); expect(old.cancelled).toBe(true);
    expect(perfil.componentInstance.misPedidos).toEqual([]);
    expect(orders.componentInstance.pedidosFiltrados).toEqual([]);
    expect(() => old.flush([pedido()])).toThrow();
    await load(B); await init;
    expect(perfil.componentInstance.misPedidos[0].usuarioId).toBe(B);
    expect(orders.componentInstance.pedidosFiltrados[0].usuarioId).toBe(B);
  });

  it('una respuesta de pedidos ya entregada no queda visible tras cambio de cuenta', async () => {
    const { perfil, orders } = createBoth(); await identity();
    http.expectOne(`${API}/pedidos/usuario/${A}`).flush([pedido()]);
    active = account('b'); const init = carrito.inicializar();
    expect(perfil.componentInstance.misPedidos).toEqual([]);
    expect(orders.componentInstance.pedidosFiltrados).toEqual([]);
    await load(B); await init;
  });

  it('sin JWT/identidad frontend no consulta pedidos y muestra error de /me sin fallback', async () => {
    const { perfil, orders } = createBoth();
    await turno(); http.expectOne(`${API}/carrito/me`).flush({}, { status: 401, statusText: 'Unauthorized' });
    await turno(); TestBed.tick();
    expect(perfil.componentInstance.misPedidos).toEqual([]);
    expect(orders.componentInstance.pedidosFiltrados).toEqual([]);
    expect(orders.componentInstance.error).toContain('ACTUALIZAR');
    http.expectNone(request => request.url.includes('/pedidos'));
  });

  it('sin cuenta no consulta backend ni asigna privilegios por correo', async () => {
    active = null; const { perfil } = createBoth();
    await turno(); TestBed.tick(); http.expectNone(() => true);
    expect(perfil.componentInstance.usuario).toBeNull();
    expect(perfil.componentInstance.esAdmin).toBe(false);
  });

  it('error de GET propio no se presenta como historial vacío confirmado y ACTUALIZAR recupera', async () => {
    const { orders } = createBoth(); await identity();
    http.expectOne(`${API}/pedidos/usuario/${A}`).flush({}, { status: 503, statusText: 'Unavailable' });
    await turno(); TestBed.tick();
    expect(orders.componentInstance.error).toContain('ACTUALIZAR');
    orders.componentInstance.actualizar(); TestBed.tick(); await turno();
    http.expectOne(`${API}/pedidos/usuario/${A}`).flush([pedido()]);
    expect(pedidos.pedidos()).toEqual([pedido()]);
    http.expectNone(`${API}/carrito/me`);
  });

  it('rechaza respuesta con pedidos ajenos aunque el HTTP haya respondido 200', async () => {
    createBoth(); await identity();
    http.expectOne(`${API}/pedidos/usuario/${A}`).flush([pedido(B)]);
    expect(pedidos.pedidos()).toEqual([]);
    expect(pedidos.error()).toContain('incompatible');
  });

  it('cancelación confirmada actualiza las dos pantallas, sin duplicar PUT', async () => {
    const { perfil, orders } = createBoth(); await load();
    orders.componentInstance.cancelarPedido(pedido()); orders.componentInstance.cancelarPedido(pedido());
    const request = http.expectOne(`${API}/pedidos/1/estado`);
    expect(request.request.method).toBe('PUT'); expect(request.request.body).toEqual({ estado: 'CANCELADO' });
    expect(perfil.componentInstance.pendientes).toBe(1); // no éxito optimista
    request.flush({ ...pedido(), estado: 'CANCELADO' });
    expect(perfil.componentInstance.pendientes).toBe(0);
    expect(orders.componentInstance.pedidosFiltrados[0].estado).toBe('CANCELADO');
  });

  it('no cancela IDs ajenos/no cargados o estados terminales', async () => {
    createBoth(); await identity();
    http.expectOne(`${API}/pedidos/usuario/${A}`).flush([{ ...pedido(), estado: 'COMPLETADO' }]);
    pedidos.cancelar(pedido()); pedidos.cancelar(pedido(B, 999)); http.expectNone(() => true);
  });

  it('error de cancelación no modifica estado ni reenvía y se informa al usuario', async () => {
    createBoth(); await load(); pedidos.cancelar(pedido());
    http.expectOne(`${API}/pedidos/1/estado`).flush({}, { status: 409, statusText: 'Conflict' });
    expect(pedidos.pedidos()[0].estado).toBe('PENDIENTE');
    expect(pedidos.error()).toContain('no se reenvió');
    http.expectNone(() => true);
  });

  it('cambio de cuenta cancela una mutación antigua y no cambia pedidos de B', async () => {
    createBoth(); await load(); pedidos.cancelar(pedido());
    const old = http.expectOne(`${API}/pedidos/1/estado`);
    active = account('b'); const init = carrito.inicializar(); TestBed.tick();
    expect(old.cancelled).toBe(true);
    await load(B); await init;
    expect(pedidos.pedidos()[0].estado).toBe('PENDIENTE');
    expect(pedidos.procesando()).toEqual({});
  });

  it('logout desde Perfil limpia identidad/datos y cancela HTTP sin borrar pedidos remotos', async () => {
    const { perfil } = createBoth(); await identity(); const old = http.expectOne(`${API}/pedidos/usuario/${A}`);
    perfil.componentInstance.logout(); TestBed.tick();
    expect(old.cancelled).toBe(true);
    expect(pedidos.pedidos()).toEqual([]); expect(carrito.identidadVerificada()).toBeNull();
    expect(logout).toHaveBeenCalledTimes(1); http.expectNone(() => true);
  });

  it('timeout de pedidos finaliza carga sin retry y permite recuperación explícita', async () => {
    createBoth(); await identity(); const request = http.expectOne(`${API}/pedidos/usuario/${A}`);
    vi.useFakeTimers(); // el timer RxJS ya usa reloj real: reemplazar mediante refresh
    pedidos.actualizar(); TestBed.tick();
    expect(request.cancelled).toBe(true);
    const pending = http.expectOne(`${API}/pedidos/usuario/${A}`);
    await vi.advanceTimersByTimeAsync(15001);
    expect(pending.cancelled).toBe(true); expect(pedidos.cargando()).toBe(false);
    expect(pedidos.error()).toContain('ACTUALIZAR'); http.expectNone(() => true);
  });

  it('Reportes no concede acceso por email y ni su método cargar llama a la API', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ReportesComponent); fixture.detectChanges();
    fixture.componentInstance.cargar();
    expect(navigate).toHaveBeenCalledWith(['/catalogo']); http.expectNone(() => true);
  });

  it('volver a las pantallas revalida una sola vez pedidos sin duplicar identidad', async () => {
    const first = createBoth(); await load(); first.perfil.destroy(); first.orders.destroy();
    const next = createBoth(); await turno(); TestBed.tick();
    http.expectOne(`${API}/pedidos/usuario/${A}`).flush([pedido(), pedido(A, 2)]);
    expect(next.perfil.componentInstance.misPedidos.length).toBe(2);
    expect(next.orders.componentInstance.pedidosFiltrados.length).toBe(2);
    http.expectNone(`${API}/carrito/me`);
  });
});
