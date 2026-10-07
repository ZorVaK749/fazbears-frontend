import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { PedidoService, Pedido, EstadoPedido } from '../../core/services/pedido.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { CarritoComponent } from '../cart/carrito.component';
import { RouterLink } from '@angular/router';
import { MsalService } from '@azure/msal-angular';

// Emails que tienen acceso de administrador
const ADMIN_EMAILS = ['vic.placencia@duocuc.cl', 'Vic.placencia@duocuc.cl'];

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [NavbarComponent, CarritoComponent, RouterLink],
  template: `
    <app-navbar />

    <main class="orders-main">
      <header class="orders-header">
        <div class="header-top">
          <div>
            <h1 class="pixel text-neon-purple">📋 {{ esAdmin ? 'TODOS LOS PEDIDOS' : 'MIS PEDIDOS' }}</h1>
            <p class="orders-sub">
              {{ esAdmin ? 'Panel de administración — Gestión de órdenes' : 'Historial de órdenes — Freddy Fazbear\'s Pizza' }}
            </p>
          </div>
          <a routerLink="/catalogo" class="btn-neon btn-neon-cyan btn-volver">← VOLVER AL MENÚ</a>
        </div>

        @if (esAdmin) {
          <div class="admin-badge pixel">⚙ MODO ADMINISTRADOR</div>
        }
      </header>

      @if (cargando) {
        <p class="pixel text-neon-cyan blink" style="text-align:center;padding:4rem">[ CARGANDO PEDIDOS... ]</p>
      }

      @if (!cargando && pedidosFiltrados.length === 0) {
        <div style="text-align:center;padding:4rem">
          <p class="pixel text-neon-purple">[ SIN PEDIDOS AÚN ]</p>
          <p style="color:var(--fnaf-muted)">¡Realiza tu primer pedido desde el menú!</p>
        </div>
      }

      @if (!cargando && pedidosFiltrados.length > 0) {
        <div class="table-wrapper">
          <table class="orders-table">
            <thead>
              <tr>
                <th class="pixel"># ID</th>
                @if (esAdmin) { <th class="pixel">USUARIO</th> }
                <th class="pixel">FECHA</th>
                <th class="pixel">PRODUCTOS</th>
                <th class="pixel">TOTAL</th>
                <th class="pixel">ESTADO</th>
                <th class="pixel">ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              @for (pedido of pedidosFiltrados; track pedido.id) {
                <tr class="order-row">
                  <td class="pixel text-neon-cyan">#{{ pedido.id }}</td>
                  @if (esAdmin) {
                    <td class="email-cell" title="{{ pedido.emailUsuario }}">
                      {{ pedido.emailUsuario | slice:0:20 }}{{ (pedido.emailUsuario?.length ?? 0) > 20 ? '…' : '' }}
                    </td>
                  }
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
                  <td class="acciones-cell">
                    <!-- Cancelar: solo si está PENDIENTE (cliente o admin) -->
                    @if (pedido.estado === 'PENDIENTE') {
                      <button
                        id="btn-cancelar-{{ pedido.id }}"
                        class="btn-accion btn-cancelar pixel"
                        [disabled]="procesando[pedido.id!]"
                        (click)="cancelarPedido(pedido)">
                        ✕ CANCELAR
                      </button>
                    }

                    <!-- Cambio de estado: solo admin -->
                    @if (esAdmin) {
                      @if (pedido.estado === 'PENDIENTE') {
                        <button
                          id="btn-preparar-{{ pedido.id }}"
                          class="btn-accion btn-preparar pixel"
                          [disabled]="procesando[pedido.id!]"
                          (click)="cambiarEstado(pedido, 'PREPARANDO')">
                          🍕 PREPARAR
                        </button>
                      }
                      @if (pedido.estado === 'PREPARANDO') {
                        <button
                          id="btn-completar-{{ pedido.id }}"
                          class="btn-accion btn-completar pixel"
                          [disabled]="procesando[pedido.id!]"
                          (click)="cambiarEstado(pedido, 'COMPLETADO')">
                          ✓ COMPLETAR
                        </button>
                      }
                      @if (pedido.estado === 'CANCELADO' || pedido.estado === 'COMPLETADO') {
                        <button
                          id="btn-eliminar-{{ pedido.id }}"
                          class="btn-accion btn-eliminar pixel"
                          [disabled]="procesando[pedido.id!]"
                          (click)="eliminarPedido(pedido)">
                          🗑 ELIMINAR
                        </button>
                      }
                    }

                    @if (procesando[pedido.id!]) {
                      <span class="pixel blink proc-txt">...</span>
                    }
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
    .orders-main { max-width: 1300px; margin: 0 auto; padding: 2rem 1.5rem; }

    .orders-header { margin-bottom: 2rem; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
    .orders-header h1 { font-size: clamp(1.3rem, 4vw, 1.8rem); margin: 0 0 0.4rem; }
    .orders-sub { color: var(--fnaf-muted); font-size: 0.85rem; margin: 0; }
    .btn-volver { font-size: 0.85rem; padding: 0.4rem 1.2rem; white-space: nowrap; display: inline-block; }

    .admin-badge {
      display: inline-block; margin-top: 0.75rem;
      background: rgba(255,215,0,0.1); border: 1px solid var(--fnaf-yellow);
      color: var(--fnaf-yellow); font-size: 0.75rem; padding: 0.3rem 1rem;
    }

    .table-wrapper { overflow-x: auto; }
    .orders-table {
      width: 100%; border-collapse: collapse;
      background: var(--fnaf-surface);
      border: 1px solid var(--fnaf-border);
    }
    .orders-table th {
      background: var(--fnaf-surface2);
      color: var(--fnaf-purple); font-size: 0.8rem;
      padding: 0.8rem 0.75rem; text-align: left;
      border-bottom: 2px solid var(--fnaf-purple-dim);
      white-space: nowrap;
    }
    .orders-table td { padding: 0.7rem 0.75rem; border-bottom: 1px solid var(--fnaf-border); vertical-align: middle; }
    .order-row { transition: background 0.2s; }
    .order-row:hover { background: rgba(181,79,255,0.04); }

    .fecha-cell { color: var(--fnaf-muted); font-size: 0.82rem; white-space: nowrap; }
    .email-cell { color: var(--fnaf-muted); font-size: 0.8rem; }
    .total-cell { font-size: 1.05rem; white-space: nowrap; }

    .items-cell { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .item-tag {
      background: var(--fnaf-surface2); border: 1px solid var(--fnaf-border);
      color: var(--fnaf-text); font-size: 0.72rem; padding: 2px 7px; border-radius: 2px;
    }

    .estado-badge { padding: 3px 8px; font-size: 0.7rem; border-radius: 2px; white-space: nowrap; }
    .badge-PENDIENTE  { background:rgba(255,215,0,0.15); color:var(--fnaf-yellow); border:1px solid var(--fnaf-yellow); }
    .badge-PREPARANDO { background:rgba(255,140,0,0.15); color:#ff8c00; border:1px solid #ff8c00; }
    .badge-COMPLETADO { background:rgba(57,255,20,0.12); color:var(--fnaf-green); border:1px solid var(--fnaf-green); }
    .badge-CANCELADO  { background:rgba(255,77,77,0.12); color:var(--fnaf-red); border:1px solid var(--fnaf-red); }

    .acciones-cell { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }

    .btn-accion {
      padding: 3px 10px; font-size: 0.7rem; cursor: pointer;
      border-radius: 2px; border: 1px solid; background: transparent;
      transition: background 0.2s, box-shadow 0.2s;
    }
    .btn-accion:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-cancelar  { color: var(--fnaf-red); border-color: var(--fnaf-red); }
    .btn-cancelar:hover:not(:disabled)  { background: rgba(255,77,77,0.12); box-shadow: 0 0 6px var(--fnaf-red); }
    .btn-preparar  { color: #ff8c00; border-color: #ff8c00; }
    .btn-preparar:hover:not(:disabled)  { background: rgba(255,140,0,0.12); }
    .btn-completar { color: var(--fnaf-green); border-color: var(--fnaf-green); }
    .btn-completar:hover:not(:disabled) { background: rgba(57,255,20,0.1); }
    .btn-eliminar  { color: var(--fnaf-muted); border-color: var(--fnaf-border); }
    .btn-eliminar:hover:not(:disabled)  { color: var(--fnaf-red); border-color: var(--fnaf-red); }
    .proc-txt { color: var(--fnaf-muted); font-size: 0.8rem; }
  `]
})
export class OrdersComponent implements OnInit {
  private pedidoSvc = inject(PedidoService);
  private msalSvc   = inject(MsalService);
  private cdr       = inject(ChangeDetectorRef);

  pedidos: Pedido[] = [];
  cargando = true;
  procesando: Record<number, boolean> = {};
  esAdmin = false;
  usuarioId = '';

  get pedidosFiltrados(): Pedido[] {
    if (this.esAdmin) return this.pedidos;
    return this.pedidos.filter(p => p.usuarioId === this.usuarioId);
  }

  ngOnInit() {
    const cuenta = this.msalSvc.instance.getAllAccounts()[0];
    this.usuarioId = cuenta?.localAccountId ?? '';
    this.esAdmin = ADMIN_EMAILS.includes(cuenta?.username ?? '');

    this.pedidoSvc.getAll().subscribe({
      next: (data) => { this.pedidos = data; this.cargando = false; this.cdr.detectChanges(); },
      error: () => { this.cargando = false; this.cdr.detectChanges(); }
    });
  }

  cancelarPedido(pedido: Pedido) {
    if (!pedido.id) return;
    this.procesando[pedido.id] = true;
    this.pedidoSvc.cancelar(pedido.id).subscribe({
      next: (actualizado) => {
        pedido.estado = actualizado.estado;
        this.procesando[pedido.id!] = false;
        this.cdr.detectChanges();
      },
      error: () => { this.procesando[pedido.id!] = false; }
    });
  }

  cambiarEstado(pedido: Pedido, nuevoEstado: EstadoPedido) {
    if (!pedido.id) return;
    this.procesando[pedido.id] = true;
    this.pedidoSvc.actualizarEstado(pedido.id, nuevoEstado).subscribe({
      next: (actualizado) => {
        pedido.estado = actualizado.estado;
        this.procesando[pedido.id!] = false;
        this.cdr.detectChanges();
      },
      error: () => { this.procesando[pedido.id!] = false; }
    });
  }

  eliminarPedido(pedido: Pedido) {
    if (!pedido.id) return;
    this.procesando[pedido.id] = true;
    this.pedidoSvc.eliminar(pedido.id).subscribe({
      next: () => {
        this.pedidos = this.pedidos.filter(p => p.id !== pedido.id);
        this.cdr.detectChanges();
      },
      error: () => { this.procesando[pedido.id!] = false; }
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
