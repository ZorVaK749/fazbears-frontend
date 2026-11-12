import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AccountInfo } from '@azure/msal-browser';
import { MsalService } from '@azure/msal-angular';
import { afterEach, vi } from 'vitest';
import { CarritoService } from './carrito.service';
import { Producto } from './producto.service';

const BASE = 'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api/carrito';
const producto: Producto = { id: 7, nombre: 'Pizza Freddy', descripcion: 'Pizza', precio: 12.99, categoria: 'PIZZA' };
const turno = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const cuenta = (uid: string, home = uid): AccountInfo => ({ localAccountId: uid, homeAccountId: home,
  tenantId: 'tenant-test', environment: 'login.microsoftonline.com', username: `${uid}@example.com` });
const dto = (uid = 'a', cantidad = 1, id = 55) => ({ usuarioId: uid, items: cantidad ? [
  { id, productoId: 7, nombreProducto: 'Pizza Freddy', cantidad, precioUnitario: 12.99 },
] : [], total: cantidad * 12.99 });

describe('Carrito persistido EV3: FIFO, sesiones y fallos', () => {
  let servicio: CarritoService;
  let http: HttpTestingController;
  let activa: AccountInfo | null;
  let cuentas: AccountInfo[];

  beforeEach(() => {
    activa = cuenta('a'); cuentas = [activa];
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: MsalService, useValue: { instance: { getActiveAccount: () => activa, getAllAccounts: () => cuentas } } },
    ] });
    servicio = TestBed.inject(CarritoService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  async function cargar(cantidad = 1, uid = 'a') {
    const carga = servicio.inicializar();
    await turno();
    http.expectOne(`${BASE}/${uid}`).flush(dto(uid, cantidad));
    await carga;
  }

  it('restaura GET persistido, ids y contador al iniciar una sesión', async () => {
    await cargar(2);
    expect(servicio.cantidadItems).toBe(2);
    expect(servicio.carrito().items[0].id).toBe(55);
    expect(servicio.carrito().total).toBeCloseTo(25.98);
    expect(await servicio.sincronizado()).toBe(true);
  });

  it('una instancia nueva recupera el carrito remoto sin depender de memoria del frontend', async () => {
    await cargar(2);
    const nueva = TestBed.runInInjectionContext(() => new CarritoService());
    expect(nueva.cantidadItems).toBe(0);
    const carga = nueva.inicializar();
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto('a', 2));
    await carga;
    expect(nueva.cantidadItems).toBe(2);
    expect(nueva.carrito().items[0].id).toBe(55);
  });

  it('deduplica inicialización simultánea de App y navbar', async () => {
    const uno = servicio.inicializar(), dos = servicio.inicializar();
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto());
    await Promise.all([uno, dos]);
    await servicio.inicializar();
    http.expectNone(() => true);
  });

  it('sin sesión no crea un carrito anónimo ni escribe por HTTP', async () => {
    activa = null; cuentas = [];
    servicio.agregarProducto(producto);
    await servicio.inicializar();
    expect(await servicio.sincronizado()).toBe(false);
    expect(servicio.carrito().items).toEqual([]);
    http.expectNone(() => true);
  });

  it('usa la cuenta activa, no la primera de varias cuentas en cache', async () => {
    activa = cuenta('b'); cuentas = [cuenta('a'), activa];
    await cargar(3, 'b');
    expect((await servicio.prepararCheckout()).usuarioId).toBe('b');
  });

  it('no escoge arbitrariamente una cuenta si hay varias sin activa', async () => {
    activa = null; cuentas = [cuenta('a'), cuenta('b')];
    await servicio.inicializar();
    expect(servicio.errorSincronizacion()).toContain('selecciona');
    http.expectNone(() => true);
  });

  it('recupera la única cuenta cacheada si no hay activa', async () => {
    activa = null;
    await cargar();
    expect(servicio.cantidadItems).toBe(1);
  });

  it('hidrata antes de agregar y no inventa éxito local', async () => {
    servicio.agregarProducto(producto);
    expect(servicio.cantidadItems).toBe(0);
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto('a', 1));
    await turno();
    const post = http.expectOne(`${BASE}/a/items`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ productoId: 7, nombreProducto: producto.nombre, cantidad: 1, precioUnitario: 12.99 });
    post.flush(dto('a', 2));
    expect(await servicio.sincronizado()).toBe(true);
    expect(servicio.cantidadItems).toBe(2);
  });

  it('dos altas intencionales del mismo producto son dos POST FIFO, no una repetición accidental', async () => {
    await cargar(0);
    servicio.agregarProducto(producto); servicio.agregarProducto(producto);
    await turno();
    const primero = http.expectOne(`${BASE}/a/items`);
    http.expectNone(`${BASE}/a/items`);
    primero.flush(dto('a', 1));
    await turno();
    const segundo = http.expectOne(`${BASE}/a/items`);
    expect(segundo.request.body.cantidad).toBe(1);
    segundo.flush(dto('a', 2));
    expect(await servicio.sincronizado()).toBe(true);
    expect(servicio.cantidadItems).toBe(2);
  });

  it('captura los datos del producto al encolar, sin observar mutaciones externas', async () => {
    await cargar(0);
    const copia = { ...producto };
    servicio.agregarProducto(copia);
    copia.precio = 999;
    await turno();
    const req = http.expectOne(`${BASE}/a/items`);
    expect(req.request.body.precioUnitario).toBe(12.99);
    req.flush(dto());
    await servicio.sincronizado();
  });

  it('calcula cada cantidad objetivo contra la última cantidad confirmada', async () => {
    await cargar(2);
    servicio.cambiarCantidad(7, 4); servicio.cambiarCantidad(7, 5);
    await turno();
    const uno = http.expectOne(`${BASE}/a/items`);
    expect(uno.request.body.cantidad).toBe(2);
    uno.flush(dto('a', 4));
    await turno();
    const dos = http.expectOne(`${BASE}/a/items`);
    expect(dos.request.body.cantidad).toBe(1);
    dos.flush(dto('a', 5));
    await servicio.sincronizado();
    expect(servicio.cantidadItems).toBe(5);
  });

  it('decrementa mediante delta solo si el ítem existe en la respuesta confirmada', async () => {
    await cargar(5);
    servicio.cambiarCantidad(7, 2);
    await turno();
    const req = http.expectOne(`${BASE}/a/items`);
    expect(req.request.body.cantidad).toBe(-3);
    req.flush(dto('a', 2));
    await servicio.sincronizado();
    expect(servicio.cantidadItems).toBe(2);
  });

  it('dos solicitudes de la misma cantidad objetivo no duplican el delta', async () => {
    await cargar(2);
    servicio.cambiarCantidad(7, 3); servicio.cambiarCantidad(7, 3);
    await turno();
    http.expectOne(`${BASE}/a/items`).flush(dto('a', 3));
    await servicio.sincronizado();
    http.expectNone(() => true);
    expect(servicio.cantidadItems).toBe(3);
  });

  it('cantidad cero borra por itemId, no por productoId', async () => {
    await cargar();
    servicio.cambiarCantidad(7, 0);
    await turno();
    const req = http.expectOne(`${BASE}/a/items/55`);
    expect(req.request.method).toBe('DELETE');
    req.flush(dto('a', 0));
    await servicio.sincronizado();
    expect(servicio.cantidadItems).toBe(0);
  });

  it('quitar después de agregar espera el id que devuelve el POST', async () => {
    await cargar(0);
    servicio.agregarProducto(producto); servicio.quitarItem(7);
    await turno();
    http.expectOne(`${BASE}/a/items`).flush(dto('a', 1, 91));
    await turno();
    http.expectOne(`${BASE}/a/items/91`).flush(dto('a', 0));
    expect(await servicio.sincronizado()).toBe(true);
  });

  it('quitar repetidamente no emite dos DELETE para el mismo ítem', async () => {
    await cargar();
    servicio.quitarItem(7); servicio.quitarItem(7);
    await turno();
    http.expectOne(`${BASE}/a/items/55`).flush(dto('a', 0));
    await servicio.sincronizado();
    http.expectNone(() => true);
  });

  it('vacía localmente solo al confirmar DELETE remoto', async () => {
    await cargar(2);
    servicio.vaciar();
    expect(servicio.cantidadItems).toBe(2);
    await turno();
    const req = http.expectOne(`${BASE}/a`);
    expect(req.request.method).toBe('DELETE');
    req.flush(dto('a', 0));
    await servicio.sincronizado();
    expect(servicio.cantidadItems).toBe(0);
  });

  it('fallo de escritura revalida GET, cancela dependientes y nunca reenvía POST', async () => {
    await cargar();
    servicio.agregarProducto(producto); servicio.agregarProducto(producto);
    await turno();
    http.expectOne(`${BASE}/a/items`).flush({}, { status: 503, statusText: 'Unavailable' });
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto('a', 2)); // pudo haberse aplicado antes de perder la respuesta
    expect(await servicio.sincronizado()).toBe(false);
    http.expectNone(() => true);
    expect(servicio.cantidadItems).toBe(2);
    expect(servicio.errorSincronizacion()).toContain('no se reenvió');
    await expect(servicio.prepararCheckout()).rejects.toThrow('sincronizar');
  });

  it('fallo de revalidación conserva el último dato conocido pero bloquea compra hasta ACTUALIZAR', async () => {
    await cargar(2);
    servicio.vaciar();
    await turno();
    http.expectOne(`${BASE}/a`).error(new ProgressEvent('error'));
    await turno();
    http.expectOne(`${BASE}/a`).error(new ProgressEvent('error'));
    expect(await servicio.sincronizado()).toBe(false);
    expect(servicio.cantidadItems).toBe(2);
    servicio.agregarProducto(producto); // no permite seguir escribiendo un estado incierto
    http.expectNone(() => true);
    const recarga = servicio.recargar();
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto('a', 0));
    await recarga;
    expect(await servicio.sincronizado()).toBe(true);
    expect(servicio.errorSincronizacion()).toBe('');
  });

  it('fallo en carga inicial cancela escrituras que dependían de esa carga', async () => {
    servicio.agregarProducto(producto);
    await turno();
    http.expectOne(`${BASE}/a`).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(await servicio.sincronizado()).toBe(false);
    http.expectNone(() => true);
    expect(servicio.carrito().items).toEqual([]);
  });

  it('timeout de 15 segundos no repite la escritura', async () => {
    await cargar();
    vi.useFakeTimers();
    servicio.agregarProducto(producto);
    await vi.advanceTimersByTimeAsync(0);
    const post = http.expectOne(`${BASE}/a/items`);
    await vi.advanceTimersByTimeAsync(15001);
    expect(post.cancelled).toBe(true);
    http.expectOne(`${BASE}/a`).flush(dto());
    expect(await servicio.sincronizado()).toBe(false);
    http.expectNone(() => true);
  });

  it('cambio de usuario cancela lectura anterior y no mezcla respuestas', async () => {
    const anterior = servicio.inicializar();
    await turno();
    const getA = http.expectOne(`${BASE}/a`);
    activa = cuenta('b'); cuentas = [activa];
    const nueva = servicio.inicializar();
    expect(getA.cancelled).toBe(true);
    expect(servicio.cantidadItems).toBe(0);
    await turno();
    http.expectOne(`${BASE}/b`).flush(dto('b', 3));
    await Promise.all([anterior, nueva]);
    expect(servicio.cantidadItems).toBe(3);
    expect(servicio.errorSincronizacion()).toBe('');
  });

  it('no ejecuta altas antiguas con la identidad de una cuenta nueva', async () => {
    await cargar();
    servicio.agregarProducto(producto); servicio.agregarProducto(producto);
    await turno();
    const postA = http.expectOne(`${BASE}/a/items`);
    activa = cuenta('b'); cuentas = [activa];
    const cargaB = servicio.inicializar();
    expect(postA.cancelled).toBe(true);
    await turno();
    http.expectOne(`${BASE}/b`).flush(dto('b', 6));
    await cargaB;
    expect(await servicio.sincronizado()).toBe(true);
    http.expectNone(() => true);
    expect(servicio.cantidadItems).toBe(6);
  });

  it('logout borra solo el estado local sin borrar carrito remoto', async () => {
    await cargar();
    servicio.cerrarSesion();
    expect(servicio.cantidadItems).toBe(0);
    expect(servicio.abierto()).toBe(false);
    http.expectNone(() => true);
  });

  it('una identidad home distinta invalida el snapshot aunque localAccountId coincida', async () => {
    await cargar();
    const snapshot = await servicio.prepararCheckout();
    activa = cuenta('a', 'otro-tenant-home'); cuentas = [activa];
    const cambio = servicio.inicializar();
    expect(servicio.snapshotVigente(snapshot)).toBe(false);
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto('a', 4));
    await cambio;
    servicio.limpiarTrasCompra(snapshot);
    http.expectNone(() => true);
    expect(servicio.cantidadItems).toBe(4);
  });

  it('rechaza respuesta de otra cuenta', async () => {
    const carga = servicio.inicializar();
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto('otra-cuenta', 5));
    await carga;
    expect(await servicio.sincronizado()).toBe(false);
    expect(servicio.carrito().items).toEqual([]);
  });

  it('rechaza ítems sin id confirmado en vez de fabricar un DELETE', async () => {
    const carga = servicio.inicializar();
    await turno();
    http.expectOne(`${BASE}/a`).flush({ usuarioId: 'a', items: [{ productoId: 7, cantidad: 1, precioUnitario: 1 }] });
    await carga;
    expect(await servicio.sincronizado()).toBe(false);
  });

  it('la barrera espera operaciones añadidas mientras se esperaba', async () => {
    await cargar(0);
    servicio.agregarProducto(producto);
    let completo = false;
    const barrera = servicio.sincronizado().then(valor => { completo = true; return valor; });
    await turno();
    const uno = http.expectOne(`${BASE}/a/items`);
    servicio.agregarProducto(producto);
    uno.flush(dto());
    await turno();
    expect(completo).toBe(false);
    http.expectOne(`${BASE}/a/items`).flush(dto('a', 2));
    expect(await barrera).toBe(true);
  });

  it('prepararCheckout entrega copia confirmada y cuenta autenticada', async () => {
    await cargar(2);
    const snapshot = await servicio.prepararCheckout();
    expect(snapshot.usuarioId).toBe('a');
    expect(snapshot.emailUsuario).toBe('a@example.com');
    expect(servicio.snapshotVigente(snapshot)).toBe(true);
    snapshot.items[0].cantidad = 99;
    expect(servicio.cantidadItems).toBe(2);
  });

  it('snapshot no queda vigente si se encola otro cambio', async () => {
    await cargar();
    const snapshot = await servicio.prepararCheckout();
    servicio.agregarProducto(producto);
    expect(servicio.snapshotVigente(snapshot)).toBe(false);
    servicio.limpiarTrasCompra(snapshot); // no borrar cambios nuevos
    await turno();
    http.expectOne(`${BASE}/a/items`).flush(dto('a', 2));
    await servicio.sincronizado();
    http.expectNone(() => true);
  });

  it('carrito vacío no produce un snapshot de compra', async () => {
    await cargar(0);
    await expect(servicio.prepararCheckout()).rejects.toThrow('vacío');
  });

  it('rechaza cantidades inválidas antes de tocar el servidor', async () => {
    servicio.agregarProducto(producto, -1);
    servicio.cambiarCantidad(7, 1.5);
    await turno();
    http.expectNone(() => true);
    expect(servicio.cantidadItems).toBe(0);
  });

  it('normaliza un precio decimal textual sin depender del total recibido', async () => {
    const carga = servicio.inicializar();
    await turno();
    http.expectOne(`${BASE}/a`).flush({ usuarioId: 'a', total: 999, items: [
      { ...dto().items[0], precioUnitario: '12.99' },
    ] });
    await carga;
    expect(servicio.carrito().total).toBeCloseTo(12.99);
  });

  it('no acepta una respuesta que duplique productoId', async () => {
    const carga = servicio.inicializar();
    await turno();
    http.expectOne(`${BASE}/a`).flush({ usuarioId: 'a', items: [dto().items[0], dto().items[0]] });
    await carga;
    expect(await servicio.sincronizado()).toBe(false);
  });

  it('no envía un decremento para un producto que ya no está en el servidor', async () => {
    await cargar(0);
    servicio.cambiarCantidad(7, 2);
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto('a', 0)); // solo revalidación del error local
    expect(await servicio.sincronizado()).toBe(false);
    http.expectNone(`${BASE}/a/items`);
  });

  it('una recarga concurrente se une a la lectura existente', async () => {
    const una = servicio.recargar(), dos = servicio.recargar();
    await turno();
    http.expectOne(`${BASE}/a`).flush(dto());
    await Promise.all([una, dos]);
    expect(await servicio.sincronizado()).toBe(true);
    http.expectNone(() => true);
  });

  it('una operación válida confirmada limpia un error local de cantidad sin ocultar errores HTTP', async () => {
    await cargar();
    servicio.cambiarCantidad(7, 1.5);
    expect(servicio.errorSincronizacion()).toContain('inválida');
    servicio.agregarProducto(producto);
    await turno(); http.expectOne(`${BASE}/a/items`).flush(dto('a', 2));
    expect(await servicio.sincronizado()).toBe(true);
    expect(servicio.errorSincronizacion()).toBe('');
  });
});
