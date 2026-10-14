import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MsalService } from '@azure/msal-angular';
import { App } from './app';
import { CarritoService } from './core/services/carrito.service';

describe('App', () => {
  let carritoInicializado: boolean;

  beforeEach(async () => {
    carritoInicializado = false;
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: MsalService,
          useValue: {
            instance: { getAllAccounts: () => [] },
            handleRedirectObservable: () => of(undefined),
          },
        },
        {
          provide: CarritoService,
          useValue: { inicializar: () => { carritoInicializado = true; } },
        },
      ],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

  it('should initialize the persisted cart after the MSAL redirect', async () => {
    TestBed.createComponent(App);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(carritoInicializado).toBe(true);
  });
});
