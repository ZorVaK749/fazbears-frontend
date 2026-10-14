import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { MsalService } from '@azure/msal-angular';
import { of } from 'rxjs';
import { CarritoService } from './carrito.service';
import { Producto } from './producto.service';

const BASE = 'https://1nqf3okm71.execute-api.us-east-1.amazonaws.com/carrito';

const producto: Producto = {
  id: 7,
  nombre: 'Pizza Margherita de Freddy',
  descripcion: 'Clásica',
  precio: 12.99,
  categoria: 'PIZZA',
};

const carritoServidor = {
  id: 3,
  usuarioId: 'user-1',
  items: [
    {
      id: 55,
      productoId: 7,
      nombreProducto: 'Pizza Margherita de Freddy',
      cantidad: 2,
      precioUnitario: 12.99,
    },
  ],
  total: 25.98,
};

/** Drena microtasks y macrotasks: la cola de sincronización es async. */
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('CarritoService', () => {
  let httpMock: HttpTestingController;
  let cuentas: Array<{ localAccountId: string }>;
  let svc: CarritoService;

  beforeEach(() => {
    cuentas = [{ localAccountId: 'user-1' }];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MsalService,
          useValue: {
            instance: { getAllAccounts: () => cuentas },
            handleRedirectObservable: () => of(undefined),
          },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(CarritoService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('sin sesión no hace llamadas HTTP y el carrito queda local', async () => {
    cuentas = [];
    svc.inicializar();
    svc.agregarProducto(producto);
    await svc.sincronizado();
    await tick();

    expect(httpMock.match(() => true).length).toBe(0);
    expect(svc.carrito().items.length).toBe(1);
    expect(svc.cantidadItems).toBe(1);
  });

  it('inicializar restaura el carrito persistido desde ms-carrito', async () => {
    svc.inicializar();
    await tick();
    const req = httpMock.expectOne(`${BASE}/user-1`);
    expect(req.request.method).toBe('GET');
    req.flush(carritoServidor);
    await svc.sincronizado();

    expect(svc.carrito().items.length).toBe(1);
    expect(svc.cantidadItems).toBe(2);
    expect(svc.carrito().total).toBeCloseTo(25.98);
  });

  it('inicializar es idempotente: no repite el GET si el usuario no cambió', async () => {
    svc.inicializar();
    await tick();
    httpMock.expectOne(`${BASE}/user-1`).flush(carritoServidor);
    await svc.sincronizado();

    svc.inicializar();
    await tick();
    expect(httpMock.match(() => true).length).toBe(0);
  });

  it('agregarProducto actualiza la UI al instante y sincroniza con POST', async () => {
    svc.agregarProducto(producto);
    // optimista: la UI ya refleja el ítem antes de la respuesta
    expect(svc.carrito().items.length).toBe(1);
    expect(svc.cantidadItems).toBe(1);

    await tick();
    const req = httpMock.expectOne(`${BASE}/user-1/items`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      productoId: 7,
      nombreProducto: 'Pizza Margherita de Freddy',
      cantidad: 1,
      precioUnitario: 12.99,
    });
    req.flush(carritoServidor);
    await svc.sincronizado();

    expect(svc.carrito().items[0].id).toBe(55);
    expect(svc.cantidadItems).toBe(2);
  });

  it('quitarItem usa el id del servidor en el DELETE', async () => {
    svc.inicializar();
    await tick();
    httpMock.expectOne(`${BASE}/user-1`).flush(carritoServidor);
    await svc.sincronizado();

    svc.quitarItem(7);
    expect(svc.carrito().items.length).toBe(0); // optimista

    await tick();
    const req = httpMock.expectOne(`${BASE}/user-1/items/55`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ ...carritoServidor, items: [] });
    await svc.sincronizado();

    expect(svc.carrito().items.length).toBe(0);
  });

  it('sin id de servidor el DELETE no se emite (nunca existió allá)', async () => {
    svc.agregarProducto(producto);
    await tick();
    const post = httpMock.expectOne(`${BASE}/user-1/items`);
    post.flush(carritoServidor);
    await svc.sincronizado();

    svc.quitarItem(999); // producto desconocido
    await svc.sincronizado();
    await tick();
    expect(httpMock.match(() => true).length).toBe(0);
  });

  it('cambiarCantidad envía el delta a ms-carrito', async () => {
    svc.inicializar();
    await tick();
    httpMock.expectOne(`${BASE}/user-1`).flush(carritoServidor);
    await svc.sincronizado();

    svc.cambiarCantidad(7, 4); // 2 → 4 = delta +2
    await tick();
    const req = httpMock.expectOne(`${BASE}/user-1/items`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.cantidad).toBe(2);
    req.flush({
      ...carritoServidor,
      items: [{ ...carritoServidor.items[0], cantidad: 4 }],
    });
    await svc.sincronizado();

    expect(svc.cantidadItems).toBe(4);
  });

  it('cambiarCantidad a cero delega en quitarItem', async () => {
    svc.inicializar();
    await tick();
    httpMock.expectOne(`${BASE}/user-1`).flush(carritoServidor);
    await svc.sincronizado();

    svc.cambiarCantidad(7, 0);
    await tick();
    const req = httpMock.expectOne(`${BASE}/user-1/items/55`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ ...carritoServidor, items: [] });
    await svc.sincronizado();

    expect(svc.carrito().items.length).toBe(0);
  });

  it('vaciar limpia en local y en el servidor', async () => {
    svc.inicializar();
    await tick();
    httpMock.expectOne(`${BASE}/user-1`).flush(carritoServidor);
    await svc.sincronizado();

    svc.vaciar();
    expect(svc.carrito().items.length).toBe(0); // optimista

    await tick();
    const req = httpMock.expectOne(`${BASE}/user-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ ...carritoServidor, items: [] });
    await svc.sincronizado();

    expect(svc.carrito().items.length).toBe(0);
  });

  it('si el servidor no confirma, revalida con GET y corrige la UI', async () => {
    svc.agregarProducto(producto);
    await tick();
    const post = httpMock.expectOne(`${BASE}/user-1/items`);
    post.error(new ProgressEvent('error'), { status: 503, statusText: 'Unavailable' });
    await tick();

    // la revalidación recarga la verdad del servidor (carrito vacío)
    const get = httpMock.expectOne(`${BASE}/user-1`);
    expect(get.request.method).toBe('GET');
    get.flush({ ...carritoServidor, items: [] });
    await svc.sincronizado();

    expect(svc.carrito().items.length).toBe(0);
  });

  it('las operaciones se serializan en orden (una a la vez)', async () => {
    svc.agregarProducto(producto, 1);
    await tick();
    const first = httpMock.expectOne(`${BASE}/user-1/items`);

    // segunda operación encolada: aún no debe emitirse en la red
    svc.agregarProducto(producto, 1);
    await tick();
    expect(httpMock.match(() => true).length).toBe(0);

    first.flush(carritoServidor);
    await tick();
    const second = httpMock.expectOne(`${BASE}/user-1/items`);
    expect(second.request.body.cantidad).toBe(1);
    second.flush(carritoServidor);
    await svc.sincronizado();

    expect(svc.cantidadItems).toBe(2);
  });

  it('al cambiar de usuario se descarta el carrito anterior', async () => {
    svc.inicializar();
    await tick();
    httpMock.expectOne(`${BASE}/user-1`).flush(carritoServidor);
    await svc.sincronizado();
    expect(svc.cantidadItems).toBe(2);

    cuentas = [{ localAccountId: 'user-2' }];
    svc.inicializar();
    expect(svc.carrito().items.length).toBe(0); // no filtrar el carrito de user-1

    await tick();
    const req = httpMock.expectOne(`${BASE}/user-2`);
    req.flush({ id: 4, usuarioId: 'user-2', items: [] });
    await svc.sincronizado();
  });
});
