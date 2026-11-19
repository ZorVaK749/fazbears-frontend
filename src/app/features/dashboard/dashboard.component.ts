import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { API_BASE_URL } from '../../core/api.config';
import { NavbarComponent } from '../../shared/navbar/navbar.component';

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
      <p>Última hora de actividad en esta cuenta</p>
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
  styles: [`
    main { max-width: 1080px; margin: auto; padding: 2rem 1rem; }
    .metricas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 1rem; }
    section { border: 1px solid var(--fnaf-muted); border-radius: .75rem; padding: 1rem; }
    .total { font-size: 2.5rem; }
    li { margin-block: .5rem; }
  `],
})
export class DashboardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);
  private readonly destroy = inject(DestroyRef);
  private socket?: WebSocket;
  private reconnect?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setTimeout>;
  private backoff = 1000;
  readonly estado = signal('Conectando…');
  readonly metrics = signal<Metrics | null>(null);

  ngOnInit() {
    this.destroy.onDestroy(() => {
      clearTimeout(this.reconnect);
      clearTimeout(this.heartbeat);
      this.socket?.close();
    });
    void this.connect();
  }

  private async connect() {
    if (this.destroy.destroyed) return;
    try {
      const response = await firstValueFrom(this.http.post<{ url: string; ticket: string }>(
        `${this.api}/analytics/me/dashboard-ticket`, {},
      ).pipe(timeout(8000)));
      if (this.destroy.destroyed) return;
      const url = new URL(response.url);
      if (url.protocol !== 'wss:' || url.pathname !== '/ws/analytics' || url.search || url.hash
          || url.username || url.password || !/^[A-Za-z0-9_-]{43}$/.test(response.ticket)) throw new Error();
      const socket = new WebSocket(url);
      this.socket = socket;
      this.watch(socket);
      socket.onopen = () => socket.send(response.ticket);
      socket.onmessage = event => {
        if (this.destroy.destroyed || this.socket !== socket) return;
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
        clearTimeout(this.heartbeat);
        this.scheduleReconnect();
      };
    } catch (error) {
      if (this.destroy.destroyed) return;
      if (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status)) {
        this.metrics.set(null);
        this.estado.set('La actividad en vivo no está disponible para esta sesión.');
      } else {
        this.scheduleReconnect();
      }
    }
  }

  private watch(socket: WebSocket) {
    clearTimeout(this.heartbeat);
    this.heartbeat = setTimeout(() => socket.close(), 30000);
  }

  private scheduleReconnect() {
    if (this.destroy.destroyed) return;
    this.metrics.set(null);
    this.estado.set('Conexión interrumpida. Reconectando…');
    this.reconnect = setTimeout(() => void this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15000);
  }
}
