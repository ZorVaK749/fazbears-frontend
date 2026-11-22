import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, map, Subscription, timeout } from 'rxjs';
import { API_BASE_URL } from '../../core/api.config';
import { CarritoService, IdentidadSesion } from '../../core/services/carrito.service';
import { formatearFechaSantiago } from '../../shared/fecha-santiago';
import { NavbarComponent } from '../../shared/navbar/navbar.component';

const acciones = [
  { tipo: 'VIEW', nombre: 'Vistas de productos' },
  { tipo: 'SELECT', nombre: 'Selecciones del catálogo' },
  { tipo: 'ADD', nombre: 'Productos agregados al carrito' },
  { tipo: 'UPDATE', nombre: 'Cambios de cantidad' },
  { tipo: 'REMOVE', nombre: 'Productos retirados del carrito' },
] as const;

interface ResumenActividad {
  totalInteracciones: number;
  productosDistintos: number;
  porTipo: Record<(typeof acciones)[number]['tipo'], number>;
  ultimaInteraccion: string | null;
}

interface Metrics {
  interacciones: number;
  productosMasVistos: ReadonlyArray<{ productoId: number; nombre: string; visitas: number }>;
  categorias: ReadonlyArray<{ categoria: string; interacciones: number }>;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NavbarComponent],
  template: `
    <app-navbar />
    <main>
      <h1 class="pixel text-neon-yellow">Mi actividad</h1>
      <section class="resumen" aria-labelledby="resumen-titulo">
        <header>
          <h2 id="resumen-titulo">Resumen de tu cuenta</h2>
          <button class="payment-action" type="button" [disabled]="cargandoResumen() || !carrito.identidadVerificada()"
                  (click)="actualizarResumen()">Actualizar resumen</button>
        </header>
        @if (cargandoResumen()) { <p role="status">Cargando resumen…</p> }
        @if (errorResumen()) { <p role="alert">{{ errorResumen() }}</p> }
        @if (resumen(); as datos) {
          <dl class="contadores">
            <div><dt>Interacciones totales</dt><dd>{{ datos.totalInteracciones }}</dd></div>
            <div><dt>Productos distintos</dt><dd>{{ datos.productosDistintos }}</dd></div>
            @for (accion of acciones; track accion.tipo) {
              <div><dt>{{ accion.nombre }}</dt><dd>{{ datos.porTipo[accion.tipo] }}</dd></div>
            }
          </dl>
          @if (datos.ultimaInteraccion; as fecha) {
            <p class="ultima">Última interacción · {{ formatFecha(fecha) }}</p>
          } @else { <p class="ultima">Todavía no tienes interacciones registradas.</p> }
        }
      </section>

      <h2>Actividad en vivo</h2>
      <p class="ultima">Última hora de actividad en esta cuenta</p>
      <p role="status">{{ estado() }}</p>
      @if (metrics(); as data) {
        <div class="metricas">
          <section>
            <h2>Interacciones</h2>
            <p class="total">{{ data.interacciones }}</p>
          </section>
          <section>
            <h2>Productos más vistos</h2>
            <ol>
              @for (producto of data.productosMasVistos; track producto.productoId) {
                <li>{{ producto.nombre }} <strong>{{ producto.visitas }}</strong></li>
              } @empty { <li>Sin vistas registradas.</li> }
            </ol>
          </section>
          <section>
            <h2>Interacciones por categoría</h2>
            <ul>
              @for (categoria of data.categorias; track categoria.categoria) {
                <li>{{ categoria.categoria }} <strong>{{ categoria.interacciones }}</strong></li>
              } @empty { <li>Sin actividad registrada.</li> }
            </ul>
          </section>
        </div>
      }
    </main>
  `,
  styleUrl: '../../shared/payment-ui.css',
  styles: [`
    main { max-width: 1080px; margin: auto; padding: 2rem 1rem; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.5rem); margin-bottom: 1rem; }
    h2 { font-size: 1.4rem; }
    .resumen { margin-bottom: 1.4rem; background: var(--fnaf-surface); }
    header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem 1rem; }
    .contadores { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: .6rem; margin-top: 1rem; }
    .contadores div { display: flex; flex-direction: column; justify-content: space-between; gap: .15rem; padding: .65rem .8rem; background: var(--fnaf-surface2); border-radius: .35rem; }
    dd { color: var(--fnaf-cyan); font-size: 1.4rem; font-weight: 700; }
    .ultima { color: #b5b5cb; margin-block: .55rem; }
    .metricas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 1rem; }
    section { border: 1px solid var(--fnaf-muted); border-radius: .75rem; padding: 1rem; }
    .total { font-size: 2.5rem; }
    li { margin-block: .5rem; }
  `],
})
export class DashboardComponent {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);
  private readonly destroy = inject(DestroyRef);
  protected readonly carrito = inject(CarritoService);
  protected readonly acciones = acciones;
  protected readonly formatFecha = formatearFechaSantiago;
  private resumenPendiente?: Subscription;
  private socket?: WebSocket;
  private reconnect?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private backoff = 1000;
  readonly resumen = signal<ResumenActividad | null>(null);
  readonly cargandoResumen = signal(false);
  readonly errorResumen = signal('');
  readonly estado = signal('');
  readonly metrics = signal<Metrics | null>(null);

  constructor() {
    effect(onCleanup => {
      const identidad = this.carrito.identidadVerificada();
      this.resumen.set(null);
      this.cargandoResumen.set(false);
      this.errorResumen.set('');
      this.metrics.set(null);
      this.estado.set(identidad ? 'Conectando…' : '');
      this.backoff = 1000;
      if (!identidad) return;
      onCleanup(() => {
        this.resumenPendiente?.unsubscribe();
        clearTimeout(this.reconnect);
        clearTimeout(this.heartbeat);
        const socket = this.socket;
        this.socket = undefined;
        socket?.close();
      });
      untracked(() => this.actualizarResumen());
      void this.connect(identidad);
    });
  }

  actualizarResumen() {
    const identidad = this.carrito.identidadVerificada();
    if (!identidad || !this.esActual(identidad) || this.cargandoResumen()) return;
    this.cargandoResumen.set(true);
    this.errorResumen.set('');
    this.resumenPendiente = this.http.get<ResumenActividad>(`${this.api}/analytics/me/resumen`).pipe(
      timeout(8000),
      map(data => {
        if (!Number.isSafeInteger(data?.totalInteracciones) || !Number.isSafeInteger(data.productosDistintos)
            || !data.porTipo || acciones.some(({ tipo }) => !Number.isSafeInteger(data.porTipo[tipo]))
            || (data.ultimaInteraccion !== null && typeof data.ultimaInteraccion !== 'string')) {
          throw new Error('Resumen incompleto');
        }
        return data;
      }),
    ).subscribe({
      next: data => {
        if (!this.esActual(identidad)) return;
        this.cargandoResumen.set(false);
        this.resumen.set(data);
      },
      error: (error: unknown) => {
        if (!this.esActual(identidad)) return;
        this.cargandoResumen.set(false);
        this.resumen.set(null);
        this.errorResumen.set(error instanceof HttpErrorResponse && [401, 403].includes(error.status)
          ? 'Vuelve a iniciar sesión para ver tu actividad.'
          : 'No se pudo cargar el resumen. Intenta actualizarlo.');
      },
    });
  }

  private esActual(identidad: Readonly<IdentidadSesion>): boolean {
    return !this.destroy.destroyed && this.carrito.esIdentidadActual(identidad);
  }

  private async connect(identidad: Readonly<IdentidadSesion>) {
    if (!this.esActual(identidad)) return;
    try {
      const response = await firstValueFrom(this.http.post<{ url: string; ticket: string }>(
        `${this.api}/analytics/me/dashboard-ticket`, {},
      ).pipe(timeout(8000), takeUntilDestroyed(this.destroy)));
      if (!this.esActual(identidad)) return;
      const url = new URL(response.url);
      if (url.protocol !== 'wss:' || url.pathname !== '/ws/analytics' || url.search || url.hash
          || url.username || url.password || !/^[A-Za-z0-9_-]{43}$/.test(response.ticket)) throw new Error();
      const socket = new WebSocket(url);
      this.socket = socket;
      this.watch(socket);
      socket.onopen = () => {
        if (this.esActual(identidad) && this.socket === socket) socket.send(response.ticket);
      };
      socket.onmessage = event => {
        if (!this.esActual(identidad) || this.socket !== socket) return;
        try {
          const data: Metrics = JSON.parse(event.data);
          if (!Number.isFinite(data.interacciones) || !Array.isArray(data.productosMasVistos)
              || !Array.isArray(data.categorias)) throw new Error();
          this.metrics.set(data);
          this.backoff = 1000;
          this.estado.set('En vivo');
          this.watch(socket);
        } catch {
          socket.close();
        }
      };
      socket.onclose = () => {
        if (!this.esActual(identidad) || this.socket !== socket) return;
        this.socket = undefined;
        clearTimeout(this.heartbeat);
        this.scheduleReconnect(identidad);
      };
    } catch (error) {
      if (!this.esActual(identidad)) return;
      if (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status)) {
        this.metrics.set(null);
        this.estado.set('La actividad en vivo no está disponible para esta sesión.');
      } else {
        this.scheduleReconnect(identidad);
      }
    }
  }

  private watch(socket: WebSocket) {
    clearTimeout(this.heartbeat);
    this.heartbeat = setTimeout(() => socket.close(), 30000);
  }

  private scheduleReconnect(identidad: Readonly<IdentidadSesion>) {
    this.metrics.set(null);
    this.estado.set('Conexión interrumpida. Reconectando…');
    this.reconnect = setTimeout(() => void this.connect(identidad), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15000);
  }
}
