import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CarritoService, CarritoState } from '../../core/services/carrito.service';
import { CarritoComponent } from './carrito.component';
import { Router } from '@angular/router';
import { vi } from 'vitest';

describe('CarritoComponent', () => {
  const abierto = signal(false);
  const carrito = signal<CarritoState>({ items: [], total: 0 });
  const sincronizando = signal(false);
  const errorSincronizacion = signal('');
  let sincronizar: () => Promise<boolean>;

  beforeEach(async () => {
    abierto.set(false);
    carrito.set({ items: [], total: 0 });
    sincronizando.set(false); errorSincronizacion.set('');
    sincronizar = () => Promise.resolve(true);
    await TestBed.configureTestingModule({
      imports: [CarritoComponent],
      providers: [
        provideRouter([]),
        { provide: CarritoService, useValue: {
          abierto, carrito, sincronizando, errorSincronizacion,
          sincronizado: () => sincronizar(), recargar: () => Promise.resolve(),
          cerrarCarrito: () => abierto.set(false),
        } },
      ],
    }).compileComponents();
  });

  it('keeps the closed panel out of keyboard navigation', () => {
    const fixture = TestBed.createComponent(CarritoComponent);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('aside') as HTMLElement;
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(fixture.nativeElement.querySelector('.carrito-overlay')).toBeNull();
  });

  it('opens from its signal and closes with Escape', () => {
    const fixture = TestBed.createComponent(CarritoComponent);
    abierto.set(true);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('aside') as HTMLElement;
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(panel.classList.contains('carrito-abierto')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(abierto()).toBe(false);
    expect(panel.hasAttribute('inert')).toBe(true);
  });

  it('shows synchronization failures without pretending the cart was saved', async () => {
    const fixture = TestBed.createComponent(CarritoComponent);
    fixture.detectChanges();
    errorSincronizacion.set('Revisa el carrito antes de continuar.');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Revisa');
    expect(fixture.nativeElement.querySelector('[role="alert"] button').textContent).toContain('ACTUALIZAR');
  });

  it('does not navigate to checkout if synchronization fails', async () => {
    const fixture = TestBed.createComponent(CarritoComponent);
    sincronizar = () => Promise.resolve(false);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await fixture.componentInstance.irAlPago();
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.abriendoCheckout()).toBe(false);
  });

  it('waits for pending synchronization and blocks duplicate navigation clicks', async () => {
    const fixture = TestBed.createComponent(CarritoComponent);
    let resolver!: (valor: boolean) => void;
    sincronizar = () => new Promise<boolean>(resolve => { resolver = resolve; });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const espera = fixture.componentInstance.irAlPago();
    await fixture.componentInstance.irAlPago();
    expect(navigate).not.toHaveBeenCalled();
    resolver(false);
    await espera;
    expect(fixture.componentInstance.abriendoCheckout()).toBe(false);
  });

  it('navigates once only after the server synchronization succeeds', async () => {
    const fixture = TestBed.createComponent(CarritoComponent);
    carrito.set({ items: [{ id: 55, productoId: 7, nombreProducto: 'Pizza', cantidad: 1, precioUnitario: 12.99 }], total: 12.99 });
    let resolver!: (valor: boolean) => void;
    sincronizar = () => new Promise<boolean>(resolve => { resolver = resolve; });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const espera = fixture.componentInstance.irAlPago();
    await fixture.componentInstance.irAlPago();
    expect(navigate).not.toHaveBeenCalled();
    resolver(true);
    await espera;
    expect(navigate).toHaveBeenCalledExactlyOnceWith(['/checkout']);
  });
});
