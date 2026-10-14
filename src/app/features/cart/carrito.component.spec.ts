import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CarritoService } from '../../core/services/carrito.service';
import { CarritoComponent } from './carrito.component';

describe('CarritoComponent', () => {
  const abierto = signal(false);
  const carrito = signal({ items: [], total: 0 });

  beforeEach(async () => {
    abierto.set(false);
    await TestBed.configureTestingModule({
      imports: [CarritoComponent],
      providers: [
        provideRouter([]),
        { provide: CarritoService, useValue: {
          abierto, carrito, cerrarCarrito: () => abierto.set(false),
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
});
