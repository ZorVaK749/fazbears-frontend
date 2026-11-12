import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Subscription, timeout } from 'rxjs';
import { CarritoService, IdentidadSesion } from './carrito.service';
import { Pedido, PedidoService } from './pedido.service';

interface MisPedidosState {
  identidad: Readonly<IdentidadSesion> | null;
  pedidos: Pedido[];
  cargando: boolean;
  error: string;
  procesando: Record<number, boolean>;
}

/** Una carga propia compartida por Perfil/Historial, nunca GET global + filtro UI. */
@Injectable({ providedIn: 'root' })
export class MisPedidosService {
  private readonly carrito = inject(CarritoService);
  private readonly api = inject(PedidoService);
  private readonly refresco = signal(0);
  private readonly estado = signal<MisPedidosState>({ identidad: null, pedidos: [],
    cargando: false, error: '', procesando: {} });
  private readonly peticiones = new Set<Subscription>();
  private generacion = 0;

  readonly pedidos = computed(() => this.vigente() ? this.estado().pedidos : []);
  readonly procesando = computed(() => this.vigente() ? this.estado().procesando : {});
  readonly cargando = computed(() => this.carrito.identidadVerificada()
    ? !this.vigente() || this.estado().cargando : this.carrito.sincronizando());
  readonly error = computed(() => this.carrito.identidadVerificada()
    ? (this.vigente() ? this.estado().error : '') : this.carrito.errorSincronizacion());

  constructor() {
    effect(onCleanup => {
      const identidad = this.carrito.identidadVerificada();
      this.refresco();
      const generacion = ++this.generacion;
      this.estado.set({ identidad, pedidos: [], cargando: !!identidad, error: '', procesando: {} });
      onCleanup(() => {
        ++this.generacion;
        for (const request of this.peticiones) request.unsubscribe();
        this.peticiones.clear();
      });
      if (!identidad || !this.actual(identidad, generacion)) return;
      this.registrar(this.api.getByUsuario(identidad.usuarioId).pipe(timeout(15000)).subscribe({
        next: pedidos => {
          if (!this.actual(identidad, generacion)) return;
          if (!Array.isArray(pedidos) || pedidos.some(p => !p || p.usuarioId !== identidad.usuarioId)) {
            this.estado.update(s => ({ ...s, cargando: false, error: 'Respuesta de pedidos incompatible.' }));
            return;
          }
          this.estado.update(s => ({ ...s, pedidos, cargando: false }));
        },
        error: () => {
          if (this.actual(identidad, generacion)) this.estado.update(s => ({ ...s,
            cargando: false, error: 'No se pudieron cargar tus pedidos. Pulsa ACTUALIZAR.' }));
        },
      }));
    });
  }

  inicializar(): void {
    void this.carrito.inicializar();
    // Revalidar al volver desde otra pantalla (p.ej. tras una orden), sin duplicar
    // la carga ya pendiente ni resolver otra vez /me.
    if (this.vigente() && !this.estado().cargando) this.refresco.update(n => n + 1);
  }

  actualizar(): void {
    if (!this.carrito.identidadVerificada()) { void this.carrito.recargar(); return; }
    this.refresco.update(n => n + 1);
  }

  cancelar(pedido: Pedido): void {
    const estado = this.estado();
    const identidad = estado.identidad;
    const id = pedido.id;
    const generacion = this.generacion;
    if (!identidad || !this.actual(identidad, generacion) || !id || estado.procesando[id]
        || !estado.pedidos.some(p => p.id === id && p.usuarioId === identidad.usuarioId && p.estado === 'PENDIENTE')) return;
    this.estado.update(s => ({ ...s, error: '', procesando: { ...s.procesando, [id]: true } }));
    this.registrar(this.api.cancelar(id).pipe(timeout(15000)).subscribe({
      next: actualizado => {
        if (!this.actual(identidad, generacion)) return;
        const valido = actualizado?.id === id && actualizado.usuarioId === identidad.usuarioId
          && actualizado.estado === 'CANCELADO';
        this.estado.update(s => ({ ...s,
          pedidos: valido ? s.pedidos.map(p => p.id === id ? actualizado : p) : s.pedidos,
          procesando: { ...s.procesando, [id]: false },
          error: valido ? '' : 'No se pudo verificar la cancelación. Pulsa ACTUALIZAR.',
        }));
      },
      error: () => {
        if (this.actual(identidad, generacion)) this.estado.update(s => ({ ...s,
          procesando: { ...s.procesando, [id]: false },
          error: 'No se confirmó la cancelación. Pulsa ACTUALIZAR; no se reenvió la operación.',
        }));
      },
    }));
  }

  private vigente(): boolean {
    const identidad = this.carrito.identidadVerificada();
    return !!identidad && identidad === this.estado().identidad && this.carrito.esIdentidadActual(identidad);
  }

  private actual(identidad: Readonly<IdentidadSesion>, generacion: number): boolean {
    return this.generacion === generacion && this.carrito.esIdentidadActual(identidad);
  }

  private registrar(subscription: Subscription): void {
    this.peticiones.add(subscription);
    subscription.add(() => this.peticiones.delete(subscription));
  }
}
