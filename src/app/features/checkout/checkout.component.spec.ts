import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { Subject } from 'rxjs';
import { afterEach, vi } from 'vitest';
import { CarritoService } from '../../core/services/carrito.service';
import { OrdenResponse, OrdenService } from '../../core/services/orden.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { CheckoutComponent } from './checkout.component';

@Component({ selector: 'app-navbar', standalone: true, template: '' })
class NavbarStub {}

describe('Checkout asynchronous rendering', () => {
  let responses: Subject<OrdenResponse>[];
  let vaciar: ReturnType<typeof vi.fn>;
  const carrito = signal({ items: [{ productoId: 1, nombreProducto: 'Pizza',
    cantidad: 1, precioUnitario: 12.99 }], total: 12.99 });

  beforeEach(async () => {
    responses = [];
    vaciar = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CheckoutComponent],
      providers: [
        provideRouter([]),
        { provide: CarritoService, useValue: { carrito, vaciar } },
        { provide: MsalService, useValue: { instance: { getAllAccounts: () => [
          { localAccountId: 'user-1', username: 'user@example.com', name: 'User' },
        ] } } },
        { provide: OrdenService, useValue: { confirmar: () => {
          const response = new Subject<OrdenResponse>();
          responses.push(response);
          return response.asObservable();
        } } },
      ],
    }).overrideComponent(CheckoutComponent, {
      remove: { imports: [NavbarComponent] }, add: { imports: [NavbarStub] },
    }).compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  function create() {
    const fixture = TestBed.createComponent(CheckoutComponent);
    fixture.componentInstance.metodoSeleccionado = 'EFECTIVO';
    fixture.detectChanges();
    return fixture;
  }

  it('renders HTTP errors and unlocks the button without another click', async () => {
    const fixture = create();
    fixture.componentInstance.procesarPago();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('PROCESANDO');
    responses[0].error({ status: 500 });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('PROCESANDO');
    expect(fixture.nativeElement.textContent).toContain('MIS PEDIDOS');
    expect(fixture.componentInstance.procesando()).toBe(false);
    expect(vaciar).not.toHaveBeenCalled();
    expect(responses.length).toBe(1); // no retry automático
  });

  it('renders 503 and allows a deliberate new attempt', async () => {
    const fixture = create();
    fixture.componentInstance.procesarPago();
    responses[0].error({ status: 503 });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('503');
    fixture.componentInstance.procesarPago();
    expect(responses.length).toBe(2);
    responses[1].error({ status: 0 });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Red');
  });

  it('times out without sending a second order or clearing the cart', async () => {
    vi.useFakeTimers();
    const fixture = create();
    fixture.componentInstance.procesarPago();
    await vi.advanceTimersByTimeAsync(30001);
    vi.useRealTimers();
    await fixture.whenStable();
    expect(fixture.componentInstance.procesando()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('tardó demasiado');
    expect(responses[0].observed).toBe(false);
    expect(responses.length).toBe(1);
    expect(vaciar).not.toHaveBeenCalled();
  });

  it('blocks double clicks and renders success asynchronously', async () => {
    const fixture = create();
    fixture.componentInstance.procesarPago();
    fixture.componentInstance.procesarPago();
    expect(responses.length).toBe(1);
    responses[0].next({ pedidoId: 42, total: 12.99, estado: 'PENDIENTE', mensaje: 'OK' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('PEDIDO #42 REGISTRADO');
    expect(fixture.componentInstance.procesando()).toBe(false);
    expect(vaciar).toHaveBeenCalledTimes(1);
    fixture.componentInstance.procesarPago();
    expect(responses.length).toBe(1);
  });

  it('unsubscribes and resets processing when leaving the page', () => {
    const fixture = create();
    fixture.componentInstance.procesarPago();
    fixture.destroy();
    expect(responses[0].observed).toBe(false);
    expect(fixture.componentInstance.procesando()).toBe(false);
    expect(vaciar).not.toHaveBeenCalled();
  });

  it('keeps validation errors local without creating orders', async () => {
    const fixture = create();
    fixture.componentInstance.metodoSeleccionado = 'TARJETA';
    fixture.componentInstance.procesarPago();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('número de tarjeta válido');
    expect(responses.length).toBe(0);
    expect(fixture.componentInstance.procesando()).toBe(false);
  });
});
