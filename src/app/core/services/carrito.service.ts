import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo } from '@azure/msal-browser';
import { Observable, Subject, firstValueFrom, takeUntil, timeout } from 'rxjs';
import { Producto } from './producto.service';
import { AZURE_TENANT_ID } from '../auth/auth.config';
import { API_BASE_URL } from '../api.config';

export interface ItemCarrito {
  id: number;
  productoId: number;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
}

export interface CarritoState { items: ItemCarrito[]; total: number; }

export interface IdentidadCarrito { usuarioId: string; tenantId: string; }
export interface IdentidadSesion extends IdentidadCarrito { sesion: number; }

export interface CarritoParaConfirmar extends CarritoState {
  usuarioId: string;
  tenantId: string;
  emailUsuario: string;
  sesion: number;
  revision: number;
}

interface SesionCarrito {
  id: number;
  clave: string;
  identidad: IdentidadCarrito | null;
  cancelar: Subject<void>;
  cola: Promise<void>;
  pendientes: number;
  secuencia: number;
  canceladasHasta: number;
  cargaSolicitada: boolean;
  cargado: boolean;
  requiereRevision: boolean;
  revision: number;
}

@Injectable({ providedIn: 'root' })
export class CarritoService {
  // Estado confirmado (no optimista): evita representar como guardada una mutación rechazada.
  // La cola es local a esta instancia; no sustituye autorización/idempotencia/concurrencia backend.
  private readonly base = `${inject(API_BASE_URL)}/carrito`;
  private readonly http = inject(HttpClient);
  private readonly msalSvc = inject(MsalService);
  private readonly estado = signal<CarritoState>({ items: [], total: 0 });
  readonly carrito = this.estado.asReadonly();
  readonly abierto = signal(false);
  readonly sincronizando = signal(false);
  readonly errorSincronizacion = signal('');
  private sesion: SesionCarrito | null = null;
  private siguienteSesion = 0;
  private readonly identidadEstado = signal<Readonly<IdentidadSesion> | null>(null);
  readonly identidadVerificada = this.identidadEstado.asReadonly();

  esIdentidadActual(identidad: Readonly<IdentidadSesion>): boolean {
    const sesion = this.sesion;
    return !!sesion && this.esActual(sesion) && identidad.sesion === sesion.id
      && identidad.usuarioId === sesion.identidad?.usuarioId
      && identidad.tenantId === sesion.identidad?.tenantId;
  }

  toggleCarrito() { this.abierto.update(valor => !valor); }
  cerrarCarrito() { this.abierto.set(false); }
  get cantidadItems() { return this.carrito().items.reduce((total, item) => total + item.cantidad, 0); }

  /** Misma cuenta que utiliza MSAL para el interceptor; no escoger entre varias arbitrariamente. */
  cuentaActual(): AccountInfo | null {
    return this.msalSvc.instance.getActiveAccount()
      ?? (this.msalSvc.instance.getAllAccounts().length === 1
        ? this.msalSvc.instance.getAllAccounts()[0] : null);
  }

  inicializar(): Promise<void> {
    const sesion = this.contexto();
    if (!sesion || sesion.cargaSolicitada) return sesion?.cola ?? Promise.resolve();
    sesion.cargaSolicitada = true;
    return this.encolar(sesion, () => this.cargar(sesion), false);
  }

  /** Refrescar es una lectura explícita, nunca reenvía un POST cuyo resultado sea incierto. */
  recargar(): Promise<void> {
    const sesion = this.contexto();
    if (!sesion) return Promise.resolve();
    if (sesion.pendientes) return sesion.cola;
    sesion.cargaSolicitada = true;
    return this.encolar(sesion, async () => {
      await this.cargar(sesion);
      if (this.esActual(sesion)) {
        sesion.requiereRevision = false;
        this.errorSincronizacion.set('');
      }
    }, false);
  }

  /** Limpieza local al salir/cambiar de cuenta: NO elimina el carrito remoto. */
  cerrarSesion(): void {
    const anterior = this.sesion;
    this.sesion = null;
    this.identidadEstado.set(null);
    anterior?.cancelar.next();
    anterior?.cancelar.complete();
    this.estado.set({ items: [], total: 0 });
    this.sincronizando.set(false);
    this.errorSincronizacion.set('');
    this.abierto.set(false);
  }

  agregarProducto(producto: Producto, cantidad = 1): void {
    if (!this.enteroPositivo(producto.id) || !this.enteroPositivo(cantidad)
        || !Number.isFinite(producto.precio) || producto.precio < 0) {
      this.errorSincronizacion.set('Producto o cantidad inválidos.');
      return;
    }
    // Capturar valores, no un objeto de catálogo que pueda mutar durante la cola.
    const item = { productoId: producto.id, nombreProducto: producto.nombre,
      cantidad, precioUnitario: producto.precio };
    this.mutar(async sesion => {
      const actual = this.carrito().items.find(i => i.productoId === item.productoId);
      if (actual && !this.enteroPositivo(actual.cantidad + cantidad)) throw new Error('Cantidad fuera de rango');
      this.aplicar(await this.pedir(sesion,
        this.http.post<unknown>(`${this.url(sesion)}/items`, item)), sesion);
    });
    this.abierto.set(true);
  }

  cambiarCantidad(productoId: number, cantidad: number): void {
    if (!this.enteroPositivo(productoId) || !Number.isInteger(cantidad) || cantidad < 0
        || cantidad > 2147483647) {
      this.errorSincronizacion.set('Cantidad inválida.');
      return;
    }
    if (cantidad === 0) { this.quitarItem(productoId); return; }
    this.mutar(async sesion => {
      // Calcular contra la última respuesta confirmada, no contra una cantidad optimista vieja.
      const item = this.carrito().items.find(i => i.productoId === productoId);
      if (!item) throw new Error('El producto ya no está en el carrito');
      const delta = cantidad - item.cantidad;
      if (!delta) return;
      // API existente: POST suma; un delta negativo solo se envía para un ítem conocido.
      this.aplicar(await this.pedir(sesion, this.http.post<unknown>(`${this.url(sesion)}/items`, {
        productoId, nombreProducto: item.nombreProducto, cantidad: delta, precioUnitario: item.precioUnitario,
      })), sesion);
    });
  }

  quitarItem(productoId: number): void {
    if (!this.enteroPositivo(productoId)) return;
    this.mutar(async sesion => {
      const item = this.carrito().items.find(i => i.productoId === productoId);
      if (!item) return; // quitar dos veces no produce dos DELETE ni usa productoId como itemId
      this.aplicar(await this.pedir(sesion,
        this.http.delete<unknown>(`${this.url(sesion)}/items/${item.id}`)), sesion);
    });
  }

  vaciar(): void {
    this.mutar(async sesion => {
      this.aplicar(await this.pedir(sesion, this.http.delete<unknown>(this.url(sesion))), sesion);
    });
  }

  /** Espera también operaciones añadidas mientras se esperaba la cola anterior. */
  async sincronizado(): Promise<boolean> {
    const sesion = this.contexto();
    if (!sesion) return false;
    await this.inicializar();
    let cola: Promise<void>;
    do { cola = sesion.cola; await cola; } while (this.esActual(sesion) && cola !== sesion.cola);
    return this.esActual(sesion) && !!sesion.identidad && sesion.cargado && !sesion.requiereRevision;
  }

  async prepararCheckout(): Promise<CarritoParaConfirmar> {
    const sesion = this.contexto();
    if (!sesion || !await this.sincronizado() || !this.esActual(sesion) || !sesion.identidad) {
      throw new Error('No se pudo sincronizar el carrito. Revísalo y actualízalo antes de confirmar.');
    }
    if (!this.carrito().items.length) throw new Error('El carrito está vacío.');
    return { ...this.carrito(), items: this.carrito().items.map(item => ({ ...item })),
      usuarioId: sesion.identidad.usuarioId, tenantId: sesion.identidad.tenantId,
      emailUsuario: this.cuentaActual()?.username ?? '',
      sesion: sesion.id, revision: sesion.revision };
  }

  snapshotVigente(snapshot: CarritoParaConfirmar): boolean {
    const sesion = this.sesion;
    return !!sesion && this.mismaSesion(snapshot)
      && snapshot.revision === sesion.revision && !sesion.pendientes && !sesion.requiereRevision;
  }

  mismaSesion(snapshot: CarritoParaConfirmar): boolean {
    return !!this.sesion && this.esActual(this.sesion) && snapshot.sesion === this.sesion.id;
  }

  /** No vaciar una cuenta nueva ni cambios posteriores a la compra que se está confirmando. */
  limpiarTrasCompra(snapshot: CarritoParaConfirmar): void {
    if (this.snapshotVigente(snapshot)) this.vaciar();
  }

  private contexto(): SesionCarrito | null {
    const cuenta = this.cuentaActual();
    const clave = cuenta ? `${cuenta.homeAccountId}|${cuenta.localAccountId}|${cuenta.tenantId}` : null;
    if (!cuenta || !clave) {
      if (this.sesion) this.cerrarSesion();
      this.errorSincronizacion.set('Inicia sesión o selecciona una cuenta para guardar el carrito.');
      return null;
    }
    if (this.sesion?.clave !== clave) {
      this.cerrarSesion();
      this.sesion = { id: ++this.siguienteSesion, clave, identidad: null,
        cancelar: new Subject<void>(), cola: Promise.resolve(), pendientes: 0,
        secuencia: 0, canceladasHasta: 0, cargaSolicitada: false, cargado: false,
        requiereRevision: false, revision: 0 };
    }
    return this.sesion;
  }

  private esActual(sesion: SesionCarrito): boolean {
    const cuenta = this.cuentaActual();
    return this.sesion === sesion && !!cuenta
      && sesion.clave === `${cuenta.homeAccountId}|${cuenta.localAccountId}|${cuenta.tenantId}`;
  }

  private mutar(operacion: (sesion: SesionCarrito) => Promise<void>): void {
    const sesion = this.contexto();
    if (!sesion) return;
    if (sesion.requiereRevision) {
      this.errorSincronizacion.set('Una operación anterior falló. Revisa el carrito y pulsa ACTUALIZAR antes de continuar.');
      return;
    }
    void this.inicializar();
    sesion.revision++;
    void this.encolar(sesion, async () => {
      if (!sesion.cargado || sesion.requiereRevision) throw new Error('Carrito sin sincronizar');
      await operacion(sesion);
    }, true);
  }

  private encolar(sesion: SesionCarrito, operacion: () => Promise<void>, escritura: boolean): Promise<void> {
    const numero = ++sesion.secuencia;
    sesion.pendientes++;
    this.sincronizando.set(true);
    const tarea = sesion.cola.then(async () => {
      if (!this.esActual(sesion) || numero <= sesion.canceladasHasta) return;
      try {
        await operacion();
        if (this.esActual(sesion) && !sesion.requiereRevision) this.errorSincronizacion.set('');
      } catch {
        if (!this.esActual(sesion)) return;
        sesion.requiereRevision = true;
        sesion.canceladasHasta = sesion.secuencia; // descartar dependientes; nunca reenviar escrituras
        this.errorSincronizacion.set('No se pudo confirmar el carrito. Se cancelaron los cambios pendientes. Revisa y pulsa ACTUALIZAR; no se reenvió la operación.');
        if (escritura) {
          try { await this.cargar(sesion); } catch { /* mantener último estado conocido, marcado como incierto */ }
        }
      }
    }).finally(() => {
      sesion.pendientes--;
      if (this.esActual(sesion)) this.sincronizando.set(sesion.pendientes > 0);
    });
    sesion.cola = tarea;
    return tarea;
  }

  private async cargar(sesion: SesionCarrito): Promise<void> {
    if (!this.esActual(sesion)) return;
    if (!sesion.identidad) {
      const respuesta = await this.pedir(sesion, this.http.get<unknown>(`${this.base}/me`));
      if (!this.esActual(sesion)) return;
      const identidad = respuesta as Partial<IdentidadCarrito> | null;
      // Comprobar forma/coherencia, no inferir oid desde localAccountId o claims del navegador.
      // La autorización criptográfica y la validez de oid/tid siguen siendo del backend.
      if (!identidad || typeof identidad.usuarioId !== 'string'
          || !/^[a-zA-Z0-9-]{1,100}$/.test(identidad.usuarioId) || identidad.usuarioId === 'me'
          || typeof identidad.tenantId !== 'string' || !identidad.tenantId
          || identidad.tenantId !== AZURE_TENANT_ID) {
        throw new Error('Identidad de carrito incompatible');
      }
      sesion.identidad = { usuarioId: identidad.usuarioId, tenantId: identidad.tenantId };
      this.identidadEstado.set(Object.freeze({ ...sesion.identidad, sesion: sesion.id }));
    }
    if (!this.esActual(sesion)) return;
    this.aplicar(await this.pedir(sesion, this.http.get<unknown>(this.url(sesion))), sesion);
    if (this.esActual(sesion)) sesion.cargado = true;
  }

  private pedir<T>(sesion: SesionCarrito, peticion: Observable<T>): Promise<T> {
    if (!this.esActual(sesion)) return Promise.reject(new Error('Sesión de carrito obsoleta'));
    // Cancelar la suscripción no puede deshacer una escritura ya recibida por el servidor.
    return firstValueFrom(peticion.pipe(timeout(15000), takeUntil(sesion.cancelar)));
  }

  private url(sesion: SesionCarrito): string {
    if (!sesion.identidad) throw new Error('Identidad de carrito no resuelta');
    return `${this.base}/${encodeURIComponent(sesion.identidad.usuarioId)}`;
  }

  private aplicar(respuesta: unknown, sesion: SesionCarrito): void {
    if (!this.esActual(sesion)) return;
    const dto = respuesta as { usuarioId?: unknown; items?: unknown } | null;
    if (!dto || !sesion.identidad || dto.usuarioId !== sesion.identidad.usuarioId || !Array.isArray(dto.items)) {
      throw new Error('Respuesta de carrito incompatible');
    }
    const productos = new Set<number>();
    const items: ItemCarrito[] = dto.items.map((valor: unknown) => {
      const item = valor as ItemCarrito;
      const precio = typeof item?.precioUnitario === 'number'
        || (typeof item?.precioUnitario === 'string' && String(item.precioUnitario).trim().length > 0)
        ? Number(item.precioUnitario) : NaN;
      if (!item || !this.enteroPositivo(item.id) || !this.enteroPositivo(item.productoId)
          || !this.enteroPositivo(item.cantidad) || typeof item.nombreProducto !== 'string'
          || !Number.isFinite(precio) || precio < 0 || productos.has(item.productoId)) {
        throw new Error('Ítem de carrito incompatible');
      }
      productos.add(item.productoId);
      return { id: item.id, productoId: item.productoId, nombreProducto: item.nombreProducto,
        cantidad: item.cantidad, precioUnitario: precio };
    });
    const total = items.reduce((suma, item) => suma + item.precioUnitario * item.cantidad, 0);
    if (!Number.isFinite(total)) throw new Error('Total incompatible');
    this.estado.set({ items, total });
  }

  private enteroPositivo(valor: number): boolean {
    return Number.isSafeInteger(valor) && valor > 0 && valor <= 2147483647;
  }
}
