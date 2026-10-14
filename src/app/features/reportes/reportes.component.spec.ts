import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { Subject } from 'rxjs';
import { afterEach, vi } from 'vitest';
import { ReportesService, ResumenReporte } from '../../core/services/reportes.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { ReportesComponent } from './reportes.component';

@Component({ selector: 'app-navbar', standalone: true, template: '' })
class NavbarStub {}

describe('ReportesComponent asynchronous rendering', () => {
  let responses: Subject<ResumenReporte>[];
  let username: string;
  const empty: ResumenReporte = {
    totalPedidos: 0, ingresosTotales: 0, promedioPerPedido: 0, ventas: [],
  };

  beforeEach(async () => {
    responses = [];
    username = 'vic.placencia@duocuc.cl';
    await TestBed.configureTestingModule({
      imports: [ReportesComponent],
      providers: [
        provideRouter([]),
        { provide: MsalService, useValue: {
          instance: { getAllAccounts: () => [{ username }] },
        } },
        { provide: ReportesService, useValue: {
          getResumen: () => {
            const response = new Subject<ResumenReporte>();
            responses.push(response);
            return response.asObservable();
          },
        } },
      ],
    }).overrideComponent(ReportesComponent, {
      remove: { imports: [NavbarComponent] },
      add: { imports: [NavbarStub] },
    }).compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  function create() {
    const fixture = TestBed.createComponent(ReportesComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a successful empty response without an extra click or detectChanges', async () => {
    const fixture = create();
    expect(fixture.nativeElement.querySelector('.loading-grid')).not.toBeNull();
    responses[0].next(empty);
    responses[0].complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-grid')).toBeNull();
    expect(fixture.nativeElement.querySelector('.error-box')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('SIN DATOS AÚN');
    expect(fixture.nativeElement.textContent).toContain('$0.00');
  });

  it('renders received sales and totals asynchronously', async () => {
    const fixture = create();
    responses[0].next({
      totalPedidos: 1, ingresosTotales: 12.99, promedioPerPedido: 12.99,
      ventas: [{ pedidoId: 42, usuarioId: 'test', total: 12.99, fechaCreacion: '2026-10-14T10:30:00' }],
    });
    responses[0].complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-grid')).toBeNull();
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('#42');
    expect(fixture.nativeElement.textContent).toContain('$12.99');
  });

  it('leaves loading on HTTP error and can retry successfully', async () => {
    const fixture = create();
    responses[0].error({ status: 503 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-grid')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('503');
    fixture.nativeElement.querySelector('.error-box button').click();
    await fixture.whenStable();
    expect(responses.length).toBe(2);
    expect(fixture.nativeElement.querySelector('.loading-grid')).not.toBeNull();
    responses[1].next(empty);
    responses[1].complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.error-box')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('SIN DATOS AÚN');
  });

  it('shows an error instead of loading forever when the request never responds', async () => {
    vi.useFakeTimers();
    const fixture = create();
    await vi.advanceTimersByTimeAsync(15001);
    vi.useRealTimers();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-grid')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('tardó demasiado');
    expect(responses[0].observed).toBe(false);
  });

  it('unsubscribes when leaving the page', () => {
    const fixture = create();
    expect(responses[0].observed).toBe(true);
    fixture.destroy();
    expect(responses[0].observed).toBe(false);
  });

  it('redirects a non-admin without requesting reports', () => {
    username = 'client@example.com';
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    create();
    expect(navigate).toHaveBeenCalledWith(['/catalogo']);
    expect(responses.length).toBe(0);
  });
});
