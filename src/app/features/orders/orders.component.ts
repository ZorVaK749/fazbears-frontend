import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Pedido } from '../../core/services/pedido.service';
import { MisPedidosService } from '../../core/services/mis-pedidos.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { ClpPipe } from '../../shared/clp.pipe';

@Component({
  selector: 'app-orders',
  imports: [NavbarComponent, RouterLink, ClpPipe],
  template: `
    <app-navbar />
    <main class="orders-main">
      <header class="orders-header">
        <div>
          <h1 class="text-neon-purple">Mis pedidos</h1>
          <p>Consulta el estado y los productos de cada pedido en pesos chilenos.</p>
        </div>
        <div class="payment-actions">
          <button type="button" class="payment-action" [disabled]="cargando" (click)="actualizar()">Actualizar</button>
          <a routerLink="/catalogo" class="payment-action payment-action--primary">Volver al menú</a>
        </div>
      </header>

      @if (cargando) { <p class="estado" role="status">Cargando pedidos…</p> }
      @if (error) { <p class="estado" role="alert">{{ error }}</p> }

      @if (!cargando && !error && !pedidosFiltrados.length) {
        <p class="estado">Todavía no tienes pedidos en pesos chilenos.</p>
      }

      @if (!cargando && pedidosFiltrados.length) {
        <ul class="lista" aria-label="Pedidos">
          @for (pedido of pedidosFiltrados; track pedido.id) {
            <li class="pedido">
              <div>
                <h2>Pedido #{{ pedido.id }}</h2>
                <p class="fecha">{{ formatFecha(pedido.fechaCreacion) }}</p>
                <span class="estado-pedido" [class]="badgeClass(pedido.estado)">{{ pedido.estado || 'Pendiente' }}</span>
              </div>
              <ul class="productos" aria-label="Productos del pedido">
                @for (item of pedido.items; track $index) {
                  <li><span>{{ item.nombreProducto }}</span><strong>×{{ item.cantidad }}</strong></li>
                }
              </ul>
              <div class="resumen">
                <p>Total <strong>{{ pedido.total | clp }}</strong></p>
                @if (pedido.estado === 'PENDIENTE' && pedido.id) {
                  <button type="button" id="btn-cancelar-{{ pedido.id }}" class="payment-action cancelar"
                          [disabled]="procesando[pedido.id]" (click)="cancelarPedido(pedido)">
                    {{ procesando[pedido.id] ? 'Cancelando…' : 'Cancelar pedido' }}
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </main>
  `,
  styleUrl: '../../shared/payment-ui.css',
  styles: [`
    .orders-main { max-width: 74rem; margin: auto; padding: clamp(1rem, 4vw, 2rem); }
    .orders-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .75rem 1.5rem; margin-block-end: 1.5rem; }
    h1 { font-size: clamp(1.7rem, 4vw, 2.5rem); line-height: 1.1; margin-block-end: .35rem; }
    .orders-header p, .fecha, .resumen p { color: #b5b5cb; }
    .orders-header .payment-actions { margin: 0; }
    .estado { padding: 1rem; border: 1px solid var(--fnaf-border); border-radius: .4rem; }
    .lista { display: grid; gap: .8rem; margin-block-start: 1rem; }
    .pedido { display: grid; grid-template-columns: minmax(8rem, 1fr) minmax(0, 2fr) auto; gap: 1rem; align-items: center; padding: 1rem; border: 1px solid var(--fnaf-border); border-radius: .45rem; background: var(--fnaf-surface); }
    h2 { color: var(--fnaf-cyan); font-size: 1.25rem; line-height: 1.2; letter-spacing: 0; }
    .fecha { margin: .25rem 0 .4rem; }
    .estado-pedido { display: inline-block; padding: .15rem .45rem; border: 1px solid currentColor; border-radius: .3rem; font-size: .8rem; text-transform: capitalize; }
    .badge-PENDIENTE { color: var(--fnaf-yellow); }
    .badge-PREPARANDO { color: #ffb66e; }
    .badge-COMPLETADO { color: #80df80; }
    .badge-CANCELADO { color: #ff8f9f; }
    .productos { display: grid; gap: .35rem; }
    .productos li { display: flex; justify-content: space-between; gap: .75rem; padding: .35rem .6rem; border-radius: .25rem; background: var(--fnaf-surface2); overflow-wrap: anywhere; }
    .resumen { display: grid; gap: .55rem; justify-items: end; }
    .resumen strong { color: var(--fnaf-text); white-space: nowrap; font-size: 1.15rem; }
    .cancelar { color: #ff9aab; border-color: #b85b71; }
    @media (max-width: 42rem) {
      .pedido { grid-template-columns: 1fr; gap: .75rem; }
      .resumen { grid-template-columns: 1fr auto; align-items: center; justify-items: start; }
    }
    @media (max-width: 23rem) { .resumen { grid-template-columns: 1fr; } }
  `],
})
export class OrdersComponent implements OnInit {
  private readonly misPedidosSvc = inject(MisPedidosService);
  readonly esAdmin = false;
  get cargando() { return this.misPedidosSvc.cargando(); }
  get procesando() { return this.misPedidosSvc.procesando(); }
  get error() { return this.misPedidosSvc.error(); }
  get pedidosFiltrados() { return this.misPedidosSvc.pedidos(); }

  ngOnInit() { this.misPedidosSvc.inicializar(); }
  cancelarPedido(pedido: Pedido) { this.misPedidosSvc.cancelar(pedido); }
  actualizar() { this.misPedidosSvc.actualizar(); }

  formatFecha(fecha?: string): string {
    if (!fecha) return '—';
    // AWS persists order creation in UTC and the legacy API sends that value without an offset.
    const fechaConZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(fecha) ? fecha : `${fecha}Z`;
    const instante = new Date(fechaConZona);
    if (Number.isNaN(instante.getTime())) return '—';
    return instante.toLocaleString('es-CL', {
      timeZone: 'America/Santiago', hourCycle: 'h23',
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  badgeClass(estado?: string): string { return `badge-${estado ?? 'PENDIENTE'}`; }
}
