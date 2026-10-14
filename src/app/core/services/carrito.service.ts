import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MsalService } from '@azure/msal-angular';
import { firstValueFrom } from 'rxjs';
import { Producto } from './producto.service';

export interface ItemCarrito {
  /** id del ítem en ms-carrito (solo cuando el servidor lo confirmó) */
  id?: number;
  productoId: number;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
}

export interface CarritoState {
  items: ItemCarrito[];
  total: number;
}

/** Forma cruda que ms-carrito devuelve en GET/POST/DELETE /api/carrito/... */
interface CarritoServer {
  id?: number;
  usuarioId?: string;
  items?: Array<{
    id?: number;
    productoId?: number;
    nombreProducto?: string | null;
    cantidad?: number | null;
    precioUnitario?: number | string | null;
  }>;
}

/**
 * Carrito de compras reactivo (signals) persistido en ms-carrito.
 *
 * - La UI siempre se actualiza de forma optimista al instante.
 * - Las operaciones al servidor se ejecutan SERIALIZADAS (una a una, en orden),
 *   de modo que las respuestas nunca se pisan y el estado converge.
 * - Cada respuesta del servidor actualiza los ids por productoId (necesarios
 *   para DELETE) y, cuando es la última operación en vuelo, reemplaza el
 *   estado local completo por la verdad del servidor.
 * - Si el servidor no confirma, se revalida con GET: la UI nunca queda mintiendo.
 * - Sin sesión de MSAL no se hacen llamadas HTTP (el estado queda solo local).
 */
@Injectable({ providedIn: 'root' })
export class CarritoService {
  private base = 'https://1nqf3okm71.execute-api.us-east-1.amazonaws.com/carrito';

  private http = inject(HttpClient);
  private msalSvc = inject(MsalService);

  /** Estado del carrito en memoria (reactivo con signals) */
  carrito = signal<CarritoState>({ items: [], total: 0 });
  abierto = signal<boolean>(false);

  /** usuario ms-carrito ya solicitado, para no repetir la carga */
  private usuarioCargado: string | null = null;
  /** ids del servidor por productoId (necesarios para DELETE) */
  private idsServidor = new Map<number, number>();
  /** operaciones encoladas aún no confirmadas por el servidor */
  private opsEnVuelo = 0;
  /** cola: todas las operaciones se ejecutan en orden, una a la vez */
  private cola: Promise<void> = Promise.resolve();

  toggleCarrito() { this.abierto.update(v => !v); }
  cerrarCarrito() { this.abierto.set(false); }

  /**
   * Carga el carrito persistido en ms-carrito. Idempotente: solo vuelve a
   * pedir si cambia el usuario o si la carga anterior falló. Llamar después
   * de que MSAL haya procesado el redirect (App.ngOnInit) y al montar el navbar.
   */
  inicializar(): void {
    const uid = this.usuarioId();
    if (!uid || uid === this.usuarioCargado) return;
    if (this.usuarioCargado && this.usuarioCargado !== uid) {
      // Cambió de cuenta: el carrito anterior no es suyo.
      this.carrito.set({ items: [], total: 0 });
      this.idsServidor = new Map();
    }
    this.usuarioCargado = uid; // evita doble carga; se revierte si falla
    this.encolar(() => this.cargar(uid));
  }

  /** Resuelve cuando la cola de sincronización termine (pruebas / antes de pagar). */
  sincronizado(): Promise<void> {
    return this.cola;
  }

  agregarProducto(producto: Producto, cantidad = 1) {
    this.carrito.update(state => {
      const existente = state.items.find(i => i.productoId === producto.id);
      let nuevosItems: ItemCarrito[];
      if (existente) {
        nuevosItems = state.items.map(i =>
          i.productoId === producto.id ? { ...i, cantidad: i.cantidad + cantidad } : i
        );
      } else {
        nuevosItems = [...state.items, {
          productoId: producto.id,
          nombreProducto: producto.nombre,
          cantidad,
          precioUnitario: producto.precio
        }];
      }
      return { items: nuevosItems, total: this.calcTotal(nuevosItems) };
    });
    this.abierto.set(true);

    this.encolar(async () => {
      const uid = this.usuarioId();
      if (!uid) return;
      try {
        const resp = await firstValueFrom(this.http.post<CarritoServer>(
          `${this.base}/${uid}/items`,
          {
            productoId: producto.id,
            nombreProducto: producto.nombre,
            cantidad,
            precioUnitario: producto.precio,
          }
        ));
        this.aplicarServidor(resp);
      } catch (error) {
        await this.revalidar(uid, error);
      }
    });
  }

  quitarItem(productoId: number) {
    this.carrito.update(state => {
      const nuevosItems = state.items.filter(i => i.productoId !== productoId);
      return { items: nuevosItems, total: this.calcTotal(nuevosItems) };
    });

    this.encolar(async () => {
      const uid = this.usuarioId();
      const id = this.idsServidor.get(productoId);
      if (!uid || id == null) return; // nunca existió en el servidor
      try {
        const resp = await firstValueFrom(this.http.delete<CarritoServer>(
          `${this.base}/${uid}/items/${id}`
        ));
        this.aplicarServidor(resp);
      } catch (error) {
        await this.revalidar(uid, error);
      }
    });
  }

  cambiarCantidad(productoId: number, cantidad: number) {
    if (cantidad <= 0) { this.quitarItem(productoId); return; }

    const anterior = this.carrito().items.find(i => i.productoId === productoId);
    this.carrito.update(state => {
      const nuevosItems = state.items.map(i =>
        i.productoId === productoId ? { ...i, cantidad } : i
      );
      return { items: nuevosItems, total: this.calcTotal(nuevosItems) };
    });

    this.encolar(async () => {
      const uid = this.usuarioId();
      if (!uid) return;
      const id = this.idsServidor.get(productoId);
      // ms-carrito no tiene "set de cantidad": si ya existe en el servidor
      // envía el delta (el backend suma); si no, la cantidad total.
      const cuerpo = {
        productoId,
        nombreProducto: anterior?.nombreProducto ?? '',
        cantidad: id == null ? cantidad : cantidad - (anterior?.cantidad ?? 0),
        precioUnitario: anterior?.precioUnitario ?? 0,
      };
      try {
        const resp = await firstValueFrom(this.http.post<CarritoServer>(
          `${this.base}/${uid}/items`, cuerpo
        ));
        this.aplicarServidor(resp);
      } catch (error) {
        await this.revalidar(uid, error);
      }
    });
  }

  vaciar() {
    this.carrito.set({ items: [], total: 0 });

    this.encolar(async () => {
      const uid = this.usuarioId();
      if (!uid) return;
      try {
        const resp = await firstValueFrom(this.http.delete<CarritoServer>(
          `${this.base}/${uid}`
        ));
        this.aplicarServidor(resp);
      } catch (error) {
        await this.revalidar(uid, error);
      }
    });
  }

  get cantidadItems() {
    return this.carrito().items.reduce((acc, i) => acc + i.cantidad, 0);
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  /** id 'sub'/local de la cuenta MSAL activa, o null si no hay sesión */
  private usuarioId(): string | null {
    const cuentas = this.msalSvc.instance.getAllAccounts();
    return cuentas[0]?.localAccountId ?? null;
  }

  /** Encola una operación; la cola garantiza orden estricto y una a la vez */
  private encolar(op: () => Promise<void>): void {
    this.opsEnVuelo++;
    this.cola = this.cola
      .then(op)
      .catch(error => {
        // red de respaldo: los errores ya se manejan dentro de cada op
        console.warn('[carrito] operación fallida:',
          (error as { status?: number })?.status ?? error);
      })
      .finally(() => { this.opsEnVuelo--; });
  }

  private async cargar(uid: string): Promise<void> {
    try {
      const resp = await firstValueFrom(
        this.http.get<CarritoServer>(`${this.base}/${uid}`)
      );
      this.usuarioCargado = uid;
      this.aplicarServidor(resp, true);
    } catch (error) {
      this.usuarioCargado = null; // permitirá reintentar en la próxima navegación
      console.warn('[carrito] no se pudo cargar desde ms-carrito:',
        (error as { status?: number })?.status ?? error);
    }
  }

  /** Tras un fallo del servidor, recarga la verdad para no dejar la UI mintiendo */
  private async revalidar(uid: string, error: unknown): Promise<void> {
    console.warn('[carrito] ms-carrito no confirmó la operación:',
      (error as { status?: number })?.status ?? error);
    try {
      const resp = await firstValueFrom(
        this.http.get<CarritoServer>(`${this.base}/${uid}`)
      );
      this.usuarioCargado = uid;
      this.aplicarServidor(resp, true);
    } catch (errorGet) {
      console.warn('[carrito] revalidación fallida:',
        (errorGet as { status?: number })?.status ?? errorGet);
    }
  }

  /**
   * Adopta la respuesta del servidor: actualiza los ids SIEMPRE y reemplaza
   * el estado local completo cuando `forzar` (carga inicial / revalidación:
   * son la verdad del servidor) o cuando esta es la última operación en vuelo
   * (opsEnVuelo <= 1). Con operaciones locales más nuevas pendientes se
   * conserva lo local: sus respuestas llegarán después y convergen.
   */
  private aplicarServidor(resp: CarritoServer | null, forzar = false): void {
    const servidor: ItemCarrito[] = (resp?.items ?? [])
      .filter(i => i.productoId != null)
      .map(i => ({
        id: i.id ?? undefined,
        productoId: i.productoId as number,
        nombreProducto: i.nombreProducto ?? '',
        cantidad: i.cantidad ?? 0,
        precioUnitario: Number(i.precioUnitario ?? 0),
      }));

    this.idsServidor = new Map();
    for (const item of servidor) {
      if (item.id != null) this.idsServidor.set(item.productoId, item.id);
    }

    if (forzar || this.opsEnVuelo <= 1) {
      this.carrito.set({ items: servidor, total: this.calcTotal(servidor) });
    }
  }

  private calcTotal(items: ItemCarrito[]): number {
    return items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0);
  }
}
