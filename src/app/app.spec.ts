import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { AccountInfo, AuthenticationResult, EventMessage, EventType, InteractionStatus } from '@azure/msal-browser';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { CarritoService } from './core/services/carrito.service';
import { App } from './app';

describe('App: inicialización del carrito con MSAL real en runtime', () => {
  let redirect: Subject<AuthenticationResult | null>;
  let progreso: Subject<InteractionStatus>;
  let eventos: Subject<EventMessage>;
  let inicializar: ReturnType<typeof vi.fn>;
  let cerrarSesion: ReturnType<typeof vi.fn>;
  let setActiveAccount: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    redirect = new Subject(); progreso = new Subject(); eventos = new Subject();
    inicializar = vi.fn(() => Promise.resolve()); cerrarSesion = vi.fn(); setActiveAccount = vi.fn();
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([]),
      { provide: MsalService, useValue: { handleRedirectObservable: () => redirect,
        instance: { setActiveAccount } } },
      { provide: MsalBroadcastService, useValue: { inProgress$: progreso, msalSubject$: eventos } },
      { provide: CarritoService, useValue: { inicializar, cerrarSesion } },
    ] }).compileComponents();
  });

  function create() { const fixture = TestBed.createComponent(App); fixture.detectChanges(); return fixture; }

  it('conserva router-outlet y no pide carrito antes de procesar sesión', () => {
    const fixture = create();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    expect(inicializar).not.toHaveBeenCalled();
  });
  it('elige cuenta del redirect antes de inicializar', () => {
    create();
    const account = { localAccountId: 'user-1' } as AccountInfo;
    redirect.next({ account } as AuthenticationResult);
    expect(setActiveAccount).toHaveBeenCalledWith(account);
    expect(inicializar).toHaveBeenCalledTimes(1);
  });
  it('restaura una sesión cacheada al quedar MSAL inactivo', () => {
    create(); progreso.next(InteractionStatus.None);
    expect(inicializar).toHaveBeenCalledTimes(1);
  });
  it('limpia estado ante logout y reevalúa cuenta activa al cambiar', () => {
    create();
    eventos.next({ eventType: EventType.LOGOUT_START } as EventMessage);
    eventos.next({ eventType: EventType.ACTIVE_ACCOUNT_CHANGED } as EventMessage);
    eventos.next({ eventType: EventType.ACCOUNT_REMOVED } as EventMessage);
    expect(cerrarSesion).toHaveBeenCalledTimes(1);
    expect(inicializar).toHaveBeenCalledTimes(2);
  });
  it('error de redirect no inicia una carga autenticada ficticia', () => {
    create(); redirect.error(new Error('redirect fallido'));
    expect(cerrarSesion).toHaveBeenCalledTimes(1);
    expect(inicializar).not.toHaveBeenCalled();
  });
  it('desuscribe los eventos al destruir la app', () => {
    const fixture = create(); fixture.destroy();
    progreso.next(InteractionStatus.None);
    expect(inicializar).not.toHaveBeenCalled();
    expect(redirect.observed).toBe(false);
    expect(eventos.observed).toBe(false);
  });
});
