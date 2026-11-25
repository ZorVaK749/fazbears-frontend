import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Pedido, puedeConfirmarRecepcion } from '../../core/services/pedido.service';
import { MisPedidosService } from '../../core/services/mis-pedidos.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { ClpPipe } from '../../shared/clp.pipe';
import { formatearFechaSantiago } from '../../shared/fecha-santiago';

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
          <button type="button" class="payment-action" [disabled]="cargando || cambiandoEstado" (click)="actualizar()">Actualizar</button>
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
                <h2>
                  @if (pedido.id) {
                    <button type="button" class="pedido-enlace" [attr.aria-expanded]="abierto(pedido)"
                            [attr.aria-controls]="abierto(pedido) ? 'comprobante-' + pedido.id : null"
                            (click)="alternarComprobante(pedido)">
                      <span>Pedido #{{ pedido.id }}</span>
                      <span class="pedido-enlace-texto">{{ abierto(pedido) ? 'Cerrar comprobante' : 'Ver comprobante' }}</span>
                    </button>
                  } @else { Pedido }
                </h2>
                <p class="fecha">{{ formatFecha(pedido.fechaCreacion) }}</p>
                <span class="estado-pedido" [class]="badgeClass(pedido.estado)" aria-live="polite">{{ pedido.estado || 'Pendiente' }}</span>
              </div>
              <ul class="productos" aria-label="Productos del pedido">
                @for (item of pedido.items; track $index) {
                  <li><span>{{ item.nombreProducto }}</span><strong>×{{ item.cantidad }}</strong></li>
                }
              </ul>
              <div class="resumen">
                <p>Total <strong>{{ pedido.total | clp }}</strong></p>
                @if (pedido.id) {
                  <div class="pedido-acciones">
                    @if (puedeConfirmarRecepcion(pedido)) {
                      <button type="button" id="btn-completar-{{ pedido.id }}" class="payment-action payment-action--primary"
                              [disabled]="!!procesando[pedido.id]" (click)="confirmarRecepcion(pedido)">
                        {{ procesando[pedido.id] === 'COMPLETADO' ? 'Confirmando…' : 'Confirmar recepción' }}
                      </button>
                    }
                    @if (pedido.estado === 'PENDIENTE') {
                      <button type="button" id="btn-cancelar-{{ pedido.id }}" class="payment-action cancelar"
                              [disabled]="!!procesando[pedido.id]" (click)="cancelarPedido(pedido)">
                        {{ procesando[pedido.id] === 'CANCELADO' ? 'Cancelando…' : 'Cancelar pedido' }}
                      </button>
                    }
                  </div>
                }
              </div>
              @if (abierto(pedido)) {
                <section class="comprobante" [id]="'comprobante-' + pedido.id" [attr.aria-labelledby]="'titulo-comprobante-' + pedido.id">
                  <h3 [id]="'titulo-comprobante-' + pedido.id">Comprobante del pedido #{{ pedido.id }}</h3>
                  <dl class="comprobante-datos">
                    <div><dt>Fecha del pedido</dt><dd>{{ formatFecha(pedido.fechaCreacion) }}</dd></div>
                    <div><dt>Estado del pedido</dt><dd>{{ pedido.estado || 'Pendiente' }}</dd></div>
                    <div><dt>Medio de pago registrado</dt><dd>{{ medioDePago(pedido.paymentStatus) }}</dd></div>
                  </dl>
                  <ul class="productos" aria-label="Detalle de importes">
                    @for (item of pedido.items; track $index) {
                      <li>
                        <div><span>{{ item.nombreProducto }}</span><small>{{ item.cantidad }} × {{ item.precioUnitario | clp }}</small></div>
                        <strong>{{ item.cantidad * item.precioUnitario | clp }}</strong>
                      </li>
                    }
                  </ul>
                  <p class="comprobante-total">Total del pedido <strong>{{ pedido.total | clp }}</strong></p>
                </section>
              }
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
    .pedido-enlace { display: grid; gap: .2rem; justify-items: start; min-height: 2.75rem; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pedido-enlace-texto { color: var(--fnaf-text); text-decoration: underline; font: 600 .9rem var(--font-body); }
    .pedido-enlace:focus-visible { outline: 2px solid var(--fnaf-yellow); outline-offset: 3px; }
    .fecha { margin: .25rem 0 .4rem; }
    .estado-pedido { display: inline-block; padding: .15rem .45rem; border: 1px solid currentColor; border-radius: .3rem; font-size: .8rem; text-transform: capitalize; }
    .badge-PENDIENTE { color: var(--fnaf-yellow); }
    .badge-PREPARANDO { color: #ffb66e; }
    .badge-COMPLETADO { color: #80df80; }
    .badge-CANCELADO { color: #ff8f9f; }
    .productos { display: grid; gap: .35rem; }
    .productos li { display: flex; justify-content: space-between; gap: .75rem; padding: .35rem .6rem; border-radius: .25rem; background: var(--fnaf-surface2); overflow-wrap: anywhere; }
    .resumen { display: grid; gap: .55rem; justify-items: end; }
    .pedido-acciones { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .45rem; }
    .resumen strong { color: var(--fnaf-text); white-space: nowrap; font-size: 1.15rem; }
    .cancelar { color: #ff9aab; border-color: #b85b71; }
    .comprobante { grid-column: 1 / -1; min-width: 0; padding: 1rem; border: 1px solid var(--fnaf-border); border-radius: .35rem; background: var(--fnaf-bg); }
    .comprobante h3 { color: var(--fnaf-cyan); font-size: 1.15rem; }
    .comprobante-datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr)); gap: .65rem 1rem; margin-block: .8rem; }
    .comprobante-datos dt, .comprobante small { color: #b5b5cb; }
    .comprobante-datos dd { margin: 0; }
    .comprobante small { display: block; }
    .comprobante strong { flex-shrink: 0; }
    .comprobante-total { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .3rem .75rem; margin-block-start: .85rem; }
    @media (max-width: 42rem) {
      .pedido { grid-template-columns: 1fr; gap: .75rem; }
      .resumen { grid-template-columns: 1fr auto; align-items: center; justify-items: start; }
      .pedido-acciones { justify-content: start; }
    }
    @media (max-width: 23rem) { .resumen { grid-template-columns: 1fr; } }
  `],
})
export class OrdersComponent implements OnInit {
  private readonly misPedidosSvc = inject(MisPedidosService);
  private readonly comprobante = signal<{ id: number; usuarioId: string } | null>(null);
  readonly esAdmin = false;
  readonly puedeConfirmarRecepcion = puedeConfirmarRecepcion;
  get cargando() { return this.misPedidosSvc.cargando(); }
  get procesando() { return this.misPedidosSvc.procesando(); }
  get cambiandoEstado() { return this.misPedidosSvc.cambiandoEstado(); }
  get error() { return this.misPedidosSvc.error(); }
  get pedidosFiltrados() { return this.misPedidosSvc.pedidos(); }

  ngOnInit() { this.misPedidosSvc.inicializar(); }
  cancelarPedido(pedido: Pedido) { this.misPedidosSvc.cancelar(pedido); }
  confirmarRecepcion(pedido: Pedido) { this.misPedidosSvc.confirmarRecepcion(pedido); }
  actualizar() { this.misPedidosSvc.actualizar(); }

  abierto(pedido: Pedido): boolean {
    const comprobante = this.comprobante();
    return comprobante !== null && comprobante.id === pedido.id && comprobante.usuarioId === pedido.usuarioId;
  }

  alternarComprobante(pedido: Pedido): void {
    if (!pedido.id) return;
    this.comprobante.set(this.abierto(pedido) ? null : { id: pedido.id, usuarioId: pedido.usuarioId });
  }

  medioDePago(estado?: string | null): string {
    switch (estado) {
      case 'APPROVED_WEBPAY_INTEGRATION': return 'Webpay de integración';
      case 'APPROVED_SIMULATED': return 'Pago simulado';
      default: return 'Sin información de pago';
    }
  }

  readonly formatFecha = formatearFechaSantiago;

  badgeClass(estado?: string): string { return `badge-${estado ?? 'PENDIENTE'}`; }
}
