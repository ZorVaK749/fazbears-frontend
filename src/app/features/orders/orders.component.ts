import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { PedidoService, Pedido } from '../../core/services/pedido.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { CarritoComponent } from '../cart/carrito.component';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [NavbarComponent, CarritoComponent, RouterLink],
  template: `
    <app-navbar />

    <main class="orders-main">
      <header class="orders-header">
        <h1 class="pixel text-neon-purple">📋 MIS PEDIDOS</h1>
        <p class="orders-sub">Historial de órdenes — Freddy Fazbear's Pizza</p>
        <a routerLink="/catalogo" class="btn-neon btn-neon-cyan" style="display:inline-block;font-size:0.9rem;padding:0.4rem 1.2rem;">
          ← VOLVER AL MENÚ
        </a>
      </header>

      @if (cargando) {
        <p class="pixel text-neon-cyan blink" style="text-align:center;padding:4rem">[ CARGANDO PEDIDOS... ]</p>
      }

      @if (!cargando && pedidos.length === 0) {
        <div style="text-align:center;padding:4rem">
          <p class="pixel text-neon-purple">[ SIN PEDIDOS AÚN ]</p>
          <p style="color:var(--fnaf-muted)">¡Realiza tu primer pedido desde el menú!</p>
        </div>
      }

      @if (!cargando && pedidos.length > 0) {
        <div class="table-wrapper">
          <table class="orders-table">
            <thead>
              <tr>
                <th class="pixel"># ID</th>
                <th class="pixel">FECHA</th>
                <th class="pixel">PRODUCTOS</th>
                <th class="pixel">TOTAL</th>
                <th class="pixel">ESTADO</th>
              </tr>
            </thead>
            <tbody>
              @for (pedido of pedidos; track pedido.id) {
                <tr class="order-row">
                  <td class="pixel text-neon-cyan">#{{ pedido.id }}</td>
                  <td class="fecha-cell">{{ formatFecha(pedido.fechaCreacion) }}</td>
                  <td class="items-cell">
                    @for (item of pedido.items; track item.productoId) {
                      <span class="item-tag">{{ item.nombreProducto }} x{{ item.cantidad }}</span>
                    }
                  </td>
                  <td class="pixel text-neon-green total-cell">\${{ pedido.total?.toFixed(2) }}</td>
                  <td>
                    <span class="estado-badge pixel" [class]="badgeClass(pedido.estado)">
                      {{ pedido.estado }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </main>

    <app-carrito />
  `,
  styles: [`
    .orders-main { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }

    .orders-header { margin-bottom: 2rem; }
    .orders-header h1 { font-size: clamp(1.5rem, 4vw, 2rem); margin: 0 0 0.5rem; }
    .orders-sub { color: var(--fnaf-muted); font-size: 0.85rem; margin: 0 0 1.5rem; }

    .table-wrapper { overflow-x: auto; }
    .orders-table {
      width: 100%; border-collapse: collapse;
      background: var(--fnaf-surface);
      border: 1px solid var(--fnaf-border);
    }
    .orders-table th {
      background: var(--fnaf-surface2);
      color: var(--fnaf-purple); font-size: 0.85rem;
      padding: 0.8rem 1rem; text-align: left;
      border-bottom: 2px solid var(--fnaf-purple-dim);
    }
    .orders-table td { padding: 0.8rem 1rem; border-bottom: 1px solid var(--fnaf-border); vertical-align: top; }
    .order-row { transition: background 0.2s; }
    .order-row:hover { background: rgba(181,79,255,0.05); }

    .fecha-cell { color: var(--fnaf-muted); font-size: 0.85rem; }
    .total-cell { font-size: 1.1rem; }

    .items-cell { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .item-tag {
      background: var(--fnaf-surface2); border: 1px solid var(--fnaf-border);
      color: var(--fnaf-text); font-size: 0.75rem; padding: 2px 8px; border-radius: 2px;
    }

    .estado-badge {
      padding: 3px 10px; font-size: 0.75rem; border-radius: 2px; white-space: nowrap;
    }
    .badge-PENDIENTE  { background:rgba(255,215,0,0.15); color:var(--fnaf-yellow); border:1px solid var(--fnaf-yellow); }
    .badge-PREPARANDO { background:rgba(255,140,0,0.15); color:#ff8c00; border:1px solid #ff8c00; }
    .badge-COMPLETADO { background:rgba(57,255,20,0.12); color:var(--fnaf-green); border:1px solid var(--fnaf-green); }
  `]
})
export class OrdersComponent implements OnInit {
  private pedidoSvc = inject(PedidoService);
  private cdr = inject(ChangeDetectorRef);
  pedidos: Pedido[] = [];
  cargando = true;

  ngOnInit() {
    this.pedidoSvc.getAll().subscribe({
      next: (data) => { this.pedidos = data; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  formatFecha(fecha?: string): string {
    if (!fecha) return '—';
    return new Date(fecha).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  badgeClass(estado?: string): string {
    return `badge-${estado ?? 'PENDIENTE'}`;
  }
}
