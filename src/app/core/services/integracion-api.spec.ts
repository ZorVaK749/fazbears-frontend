import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { API_BASE_URL } from '../api.config';
import { CarritoService, IdentidadSesion } from './carrito.service';
import { FidelizacionService } from './fidelizacion.service';
import { RecomendacionesService } from './recomendaciones.service';
import { FazcoinsComponent } from '../../shared/fazcoins/fazcoins.component';
import { RecomendacionesComponent } from '../../shared/recomendaciones/recomendaciones.component';

describe('Reward and recommendation API / UI contracts (mock HTTP, not Azure browser)', () => {
  let http: HttpTestingController;
  let identidad: ReturnType<typeof signal<Readonly<IdentidadSesion> | null>>;
  let carrito: { identidadVerificada: typeof identidad; esIdentidadActual: ReturnType<typeof vi.fn>;
    inicializar: ReturnType<typeof vi.fn>; agregarProducto: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    identidad = signal<Readonly<IdentidadSesion> | null>({ usuarioId: 'owner-a', tenantId: 'tenant', sesion: 1 });
    carrito = { identidadVerificada: identidad, esIdentidadActual: vi.fn(i => i === identidad()),
      inicializar: vi.fn(() => Promise.resolve()), agregarProducto: vi.fn() };
    TestBed.configureTestingModule({ imports: [FazcoinsComponent, RecomendacionesComponent], providers: [
      provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE_URL, useValue: '/api' },
      { provide: CarritoService, useValue: carrito },
    ] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  const saldo = { saldo: 135, disponible: 135, deuda: 0, simulacion: true };
  function walletRead() {
    http.expectOne('/api/fidelizacion/me/saldo').flush(saldo);
    http.expectOne('/api/fidelizacion/me/movimientos').flush([{ tipo: 'CREDITO', cantidad: 135 }]);
    http.expectOne('/api/fidelizacion/recompensas').flush([{ id: 'faz-vip', nombre: 'Insignia Faz VIP', costo: 100 }]);
  }
  const recs = { estrategia: 'FALLBACK_POPULARITY', generadoEn: '2026-01-01', items: [
    { productoId: 7, nombre: 'Pizza backend', categoria: 'PIZZA', precio: 13, score: 0.5, razon: 'Popularidad real' },
  ] };
  it('uses relative injected API base for personalized recommendations, without owner in request', () => {
    TestBed.inject(RecomendacionesService).obtener().subscribe();
    const req = http.expectOne('/api/recomendaciones/me?limit=6');
    expect(req.request.method).toBe('GET'); expect(req.request.body).toBeNull(); req.flush(recs);
  });
  it('records VIEW and SELECT only with tipo in authenticated API request', () => {
    const svc = TestBed.inject(RecomendacionesService);
    for (const tipo of ['VIEW', 'SELECT'] as const) {
      svc.interaccion(7, tipo).subscribe(); const r = http.expectOne('/api/productos/7/interacciones');
      expect(r.request.body).toEqual({ tipo }); r.flush(null);
    }
  });
  it('loads actual wallet balance, ledger, rewards and explicit no-discount copy', () => {
    const f = TestBed.createComponent(FazcoinsComponent); f.detectChanges(); walletRead(); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('135');
    expect(f.nativeElement.textContent).toContain('CREDITO');
    expect(f.nativeElement.textContent).toContain('no son pagos ni descuentan');
    expect(f.nativeElement.textContent).not.toContain('1,500');
  });
  it('renders dynamic fallback recommendation strategy and sends selection interaction', () => {
    const f = TestBed.createComponent(RecomendacionesComponent); f.detectChanges();
    http.expectOne('/api/recomendaciones/me?limit=6').flush(recs); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('FALLBACK_POPULARITY');
    expect(f.nativeElement.textContent).toContain('no es personalización');
    expect(f.nativeElement.textContent).toContain('Pizza backend');
    f.componentInstance.seleccionar(recs.items[0]);
    const r = http.expectOne('/api/productos/7/interacciones'); expect(r.request.body).toEqual({ tipo: 'SELECT' }); r.flush(null);
    http.expectOne('/api/productos/7').flush({ id: 7, nombre: 'Pizza actual', categoria: 'PIZZA', precio: 15, descripcion: 'Catálogo' });
    expect(carrito.agregarProducto).toHaveBeenCalledWith(expect.objectContaining({ id: 7, precio: 15 }));
  });
  it('recommendation error shows catalogue fallback, not invented recommendations', () => {
    const f = TestBed.createComponent(RecomendacionesComponent); f.detectChanges();
    http.expectOne('/api/recomendaciones/me?limit=6').flush({}, { status: 503, statusText: 'Unavailable' }); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('catálogo general, sin personalización');
    expect(f.componentInstance.resultado()).toBeNull();
  });
  it('a late recommendation from the old session cannot appear in the new account', () => {
    const f = TestBed.createComponent(RecomendacionesComponent); f.detectChanges();
    const old = http.expectOne('/api/recomendaciones/me?limit=6'); identidad.set(null); old.flush(recs); f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('Pizza backend');
    f.componentInstance.seleccionar(recs.items[0]); expect(carrito.agregarProducto).not.toHaveBeenCalled();
  });
  it('late wallet reads do not expose previous-account balance or history', () => {
    const f = TestBed.createComponent(FazcoinsComponent); f.detectChanges(); identidad.set(null);
    walletRead(); f.detectChanges(); expect(f.nativeElement.textContent).not.toContain('135');
  });
  it('canje retries keep original key/body after 503 even if another reward was selected', async () => {
    const svc = TestBed.inject(FidelizacionService);
    const first = svc.solicitarCanje('faz-vip'); const firstAssert = expect(first).rejects.toThrow('misma recompensa');
    const req = http.expectOne('/api/fidelizacion/me/canjes');
    expect(req.request.body).toEqual({ recompensaId: 'faz-vip', cantidad: 1 });
    const key = req.request.headers.get('Idempotency-Key'); expect(key).toBeTruthy();
    req.flush({}, { status: 503, statusText: 'Unavailable' }); await firstAssert;
    const retry = svc.solicitarCanje('other'); const r = http.expectOne('/api/fidelizacion/me/canjes');
    expect(r.request.body).toEqual(req.request.body); expect(r.request.headers.get('Idempotency-Key')).toBe(key);
    r.flush({}); await retry;
  });
  for (const status of [422, 409]) {
    it(`canje ${status} is an explicit failure and allows a new key`, async () => {
      const svc = TestBed.inject(FidelizacionService); const p = svc.solicitarCanje('faz-vip');
      const assertion = expect(p).rejects.toThrow(String(status)); const req = http.expectOne('/api/fidelizacion/me/canjes');
      req.flush({}, { status, statusText: 'Rejected' }); await assertion;
      const next = svc.solicitarCanje('faz-vip'); const r = http.expectOne('/api/fidelizacion/me/canjes');
      expect(r.request.headers.get('Idempotency-Key')).not.toBe(req.request.headers.get('Idempotency-Key')); r.flush({}); await next;
    });
  }
  it('wallet pending write cannot be replayed under a different session', async () => {
    const svc = TestBed.inject(FidelizacionService); const p = svc.solicitarCanje('faz-vip');
    const assertion = expect(p).rejects.toThrow(); const req = http.expectOne('/api/fidelizacion/me/canjes');
    req.error(new ProgressEvent('error')); await assertion;
    identidad.set({ usuarioId: 'b', tenantId: 'tenant', sesion: 2 });
    const next = svc.solicitarCanje('new-reward'); const r = http.expectOne('/api/fidelizacion/me/canjes');
    expect(r.request.body).toEqual({ recompensaId: 'new-reward', cantidad: 1 });
    expect(r.request.headers.get('Idempotency-Key')).not.toBe(req.request.headers.get('Idempotency-Key')); r.flush({}); await next;
  });
  it('canje UI waits for success and then refreshes actual ledger and balance', async () => {
    const f = TestBed.createComponent(FazcoinsComponent); f.detectChanges(); walletRead();
    const p = f.componentInstance.canjear('faz-vip'); const r = http.expectOne('/api/fidelizacion/me/canjes');
    expect(f.componentInstance.ocupado()).toBe(true); r.flush({}); await p; walletRead(); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Recompensa digital canjeada');
    expect(f.nativeElement.textContent).toContain('total del pedido no cambia');
  });
});
