import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo } from '@azure/msal-browser';
import { vi } from 'vitest';
import { CarritoService } from '../../core/services/carrito.service';
import { NavbarComponent } from './navbar.component';

describe('Navbar and authenticated cart', () => {
  let inicializar: ReturnType<typeof vi.fn>;
  let cerrarSesion: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    inicializar = vi.fn(() => Promise.resolve()); cerrarSesion = vi.fn(); logout = vi.fn();
    await TestBed.configureTestingModule({ imports: [NavbarComponent], providers: [provideRouter([]),
      { provide: MsalService, useValue: { logoutRedirect: logout } },
      { provide: CarritoService, useValue: { inicializar, cerrarSesion,
        cuentaActual: () => ({ username: 'cuenta-activa@example.com', name: 'Cuenta activa' } as AccountInfo),
        cantidadItems: 2, toggleCarrito: () => {}, abierto: signal(false) } },
    ] }).compileComponents();
  });
  it('initializes persisted cart and uses the same selected account', () => {
    const fixture = TestBed.createComponent(NavbarComponent); fixture.detectChanges();
    expect(inicializar).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.usuario?.username).toBe('cuenta-activa@example.com');
    expect(fixture.nativeElement.querySelector('.carrito-badge').textContent).toBe('2');
  });
  it('logout clears local cart before redirect without remote deletion', () => {
    const fixture = TestBed.createComponent(NavbarComponent);
    fixture.componentInstance.logout(new Event('click'));
    expect(cerrarSesion).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(cerrarSesion.mock.invocationCallOrder[0]).toBeLessThan(logout.mock.invocationCallOrder[0]);
  });
});
