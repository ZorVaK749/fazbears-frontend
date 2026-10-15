import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { of, Subject } from 'rxjs';
import { afterEach, vi } from 'vitest';
import { Pedido, PedidoService } from '../../core/services/pedido.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { CarritoComponent } from '../cart/carrito.component';
import { OrdersComponent } from './orders.component';

@Component({ selector: 'app-navbar', standalone: true, template: '' })
class NavbarStub {}
@Component({ selector: 'app-carrito', standalone: true, template: '' })
class CarritoStub {}

describe('Orders cancellation and asynchronous errors', () => {
  let pedido: Pedido;
  let response: Subject<Pedido>;
  let cancelar: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pedido = { id: 3, usuarioId: 'u1', emailUsuario: 'user@example.com',
      estado: 'PENDIENTE', total: 12.99, items: [] };
    response = new Subject<Pedido>();
    cancelar = vi.fn(() => response.asObservable());
    await TestBed.configureTestingModule({
      imports: [OrdersComponent],
      providers: [provideRouter([]),
        { provide: MsalService, useValue: { instance: { getAllAccounts: () => [
          { localAccountId: 'u1', username: 'vic.placencia@duocuc.cl' },
        ] } } },
        { provide: PedidoService, useValue: { getAll: () => of([pedido]), cancelar,
          actualizarEstado: () => response.asObservable(), eliminar: () => response.asObservable() } },
      ],
    }).overrideComponent(OrdersComponent, {
      remove: { imports: [NavbarComponent, CarritoComponent] },
      add: { imports: [NavbarStub, CarritoStub] },
    }).compileComponents();
  });
  afterEach(() => vi.useRealTimers());

  function create() {
    const fixture = TestBed.createComponent(OrdersComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('cancels a pending order without preparing or deleting it', async () => {
    const fixture = create();
    fixture.componentInstance.cancelarPedido(pedido);
    response.next({ ...pedido, estado: 'CANCELADO' });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('CANCELADO');
    expect(fixture.componentInstance.pedidos.length).toBe(1);
    expect(fixture.nativeElement.querySelector('#btn-cancelar-3')).toBeNull();
    expect(fixture.componentInstance.procesando()[3]).toBe(false);
  });

  it('400 displays an error and unlocks Cancel and Prepare without another click', async () => {
    const fixture = create();
    fixture.componentInstance.cancelarPedido(pedido);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#btn-cancelar-3').disabled).toBe(true);
    response.error({ status: 400 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('400');
    expect(fixture.nativeElement.querySelector('#btn-cancelar-3').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('#btn-preparar-3').disabled).toBe(false);
    expect(pedido.estado).toBe('PENDIENTE');
  });

  it('blocks repeated clicks while pending', () => {
    const fixture = create();
    fixture.componentInstance.cancelarPedido(pedido);
    fixture.componentInstance.cancelarPedido(pedido);
    expect(cancelar).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(response.observed).toBe(false);
  });

  it('unlocks on timeout without retrying', async () => {
    vi.useFakeTimers();
    const fixture = create();
    fixture.componentInstance.cancelarPedido(pedido);
    await vi.advanceTimersByTimeAsync(30001);
    vi.useRealTimers();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#btn-cancelar-3').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('tiempo de espera');
    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it('also unlocks other state changes after errors', async () => {
    const fixture = create();
    fixture.componentInstance.cambiarEstado(pedido, 'PREPARANDO');
    response.error({ status: 503 });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#btn-preparar-3').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('503');
  });
});
