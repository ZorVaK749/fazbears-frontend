import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { ANALYTICS_LIVE_ENABLED, API_BASE_URL } from '../../core/api.config';
import { CarritoService, IdentidadSesion } from '../../core/services/carrito.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { DashboardComponent } from './dashboard.component';

@Component({ selector: 'app-navbar', template: '' })
class NavbarStub {}

class SocketStub {
  static instances: SocketStub[] = [];
  onopen?: () => void;
  onmessage?: (message: MessageEvent) => void;
  onclose?: () => void;
  readonly send = vi.fn();
  readonly close = vi.fn(() => this.onclose?.());

  constructor(readonly url: URL) { SocketStub.instances.push(this); }
}

describe('Mi actividad', () => {
  const ticket = '/api/analytics/me/dashboard-ticket';
  const resumen = '/api/analytics/me/resumen';
  const datos = { totalInteracciones: 2, productosDistintos: 1,
    porTipo: { VIEW: 1, SELECT: 0, ADD: 1, UPDATE: 0, REMOVE: 0 }, ultimaInteraccion: '2026-11-22T21:42:00Z' };
  let identidad: ReturnType<typeof signal<Readonly<IdentidadSesion> | null>>;

  beforeEach(() => {
    identidad = signal<Readonly<IdentidadSesion> | null>({ usuarioId: 'a', tenantId: 'tenant', sesion: 1 });
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE_URL, useValue: '/api' },
        { provide: ANALYTICS_LIVE_ENABLED, useValue: true },
        { provide: CarritoService, useValue: { identidadVerificada: identidad, esIdentidadActual: (i: IdentidadSesion) => i === identidad() } }],
    }).overrideComponent(DashboardComponent, {
      remove: { imports: [NavbarComponent] }, add: { imports: [NavbarStub] },
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('muestra y actualiza los contadores de Productos y Carrito con WebSocket deshabilitado', async () => {
    TestBed.overrideProvider(ANALYTICS_LIVE_ENABLED, { useValue: false });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const request = http.expectOne(resumen);
    expect(request.request.method).toBe('GET');
    request.flush(datos);
    await fixture.whenStable();
    const vista: HTMLElement = fixture.nativeElement;
    const contadores = vista.querySelector('.contadores')!;
    expect(vista.textContent).not.toContain('Actividad en vivo');
    expect(contadores.textContent).toContain('Vistas de productos1');
    expect(contadores.textContent).toContain('Productos agregados al carrito1');
    expect(vista.textContent).toMatch(/22 nov 2026.*18:42/);

    vista.querySelector('button')!.click();
    http.expectOne(resumen).flush({ ...datos, totalInteracciones: 3, porTipo: { ...datos.porTipo, ADD: 2 } });
    fixture.detectChanges();
    expect(contadores.textContent).toContain('Productos agregados al carrito2');
    http.expectNone(ticket);
  });

  it('descarta la consulta anterior y limpia las métricas cuando cambia la sesión', async () => {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const resumenA = http.expectOne(resumen);
    const ticketA = http.expectOne(ticket);
    identidad.set({ usuarioId: 'b', tenantId: 'tenant', sesion: 2 });
    fixture.detectChanges();
    expect(resumenA.cancelled).toBe(true);
    ticketA.flush({ code: 'FORBIDDEN' }, { status: 403, statusText: 'Forbidden' });
    http.expectOne(ticket).flush({ code: 'FORBIDDEN' }, { status: 403, statusText: 'Forbidden' });
    http.expectOne(resumen).flush({}, { status: 503, statusText: 'Unavailable' });
    await fixture.whenStable();
    expect(fixture.componentInstance.resumen()).toBeNull();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Intenta actualizarlo');
  });

  it('authenticates the socket by frame and reconnects with a fresh ticket', async () => {
    const http = TestBed.inject(HttpTestingController);
    vi.stubGlobal('WebSocket', SocketStub);
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(DashboardComponent);
    const url = 'wss://analytics.example.test/ws/analytics';
    try {
      fixture.detectChanges();
      http.expectOne(resumen).flush(datos);
      http.expectOne(ticket).flush({ url, ticket: 'a'.repeat(43) });
      await Promise.resolve();
      const first = SocketStub.instances[0];
      first.onopen?.();
      expect(first.url.toString()).toBe(url);
      expect(first.send).toHaveBeenCalledWith('a'.repeat(43));
      first.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
        interacciones: 1, productosMasVistos: [{ productoId: 1, nombre: 'Pizza', visitas: 1 }],
        categorias: [{ categoria: 'PIZZA', interacciones: 1 }],
      }) }));
      expect(fixture.componentInstance.metrics()?.interacciones).toBe(1);

      first.close();
      await vi.advanceTimersByTimeAsync(1000);
      http.expectOne(ticket).flush({ url, ticket: 'b'.repeat(43) });
      await Promise.resolve();
      const second = SocketStub.instances[1];
      second.onopen?.();
      expect(second.send).toHaveBeenCalledWith('b'.repeat(43));
    } finally {
      fixture.destroy();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      SocketStub.instances = [];
    }
  });
});
