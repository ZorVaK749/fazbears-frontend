import { Component, inject } from '@angular/core';
import { CarritoService } from '../../core/services/carrito.service';
import { PedidoService } from '../../core/services/pedido.service';

@Component({
  selector: 'app-carrito',
  standalone: true,
  imports: [],
  template: `
    <!-- Overlay oscuro al abrir -->
    @if (carritoSvc.abierto()) {
      <div class="carrito-overlay" (click)="carritoSvc.cerrarCarrito()"></div>
    }

    <!-- Panel lateral -->
    <aside class="carrito-panel" [class.carrito-abierto]="carritoSvc.abierto()">
      <!-- Header -->
      <div class="carrito-header">
        <h2 class="pixel text-neon-cyan">🛒 CARRITO</h2>
        <button class="btn-cerrar pixel" (click)="carritoSvc.cerrarCarrito()">✕</button>
      </div>

      <!-- Items -->
      <div class="carrito-items">
        @if (carritoSvc.carrito().items.length === 0) {
          <div class="carrito-vacio">
            <p class="pixel text-neon-purple blink">[ CARRITO VACÍO ]</p>
            <p class="carrito-hint">Agrega productos del menú para comenzar</p>
          </div>
        }

        @for (item of carritoSvc.carrito().items; track item.productoId) {
          <div class="carrito-item">
            <div class="item-info">
              <p class="item-nombre">{{ item.nombreProducto }}</p>
              <p class="item-precio pixel text-neon-green">
                \${{ (item.precioUnitario * item.cantidad).toFixed(2) }}
              </p>
            </div>
            <div class="item-controles">
              <button class="btn-ctrl" (click)="carritoSvc.cambiarCantidad(item.productoId, item.cantidad - 1)">−</button>
              <span class="pixel item-cant">{{ item.cantidad }}</span>
              <button class="btn-ctrl" (click)="carritoSvc.cambiarCantidad(item.productoId, item.cantidad + 1)">+</button>
              <button class="btn-quitar" (click)="carritoSvc.quitarItem(item.productoId)">🗑</button>
            </div>
          </div>
        }
      </div>

      <!-- Footer con total y botón -->
      @if (carritoSvc.carrito().items.length > 0) {
        <div class="carrito-footer">
          <div class="total-row">
            <span class="pixel total-label">TOTAL:</span>
            <span class="pixel text-neon-green total-valor">
              \${{ carritoSvc.carrito().total.toFixed(2) }}
            </span>
          </div>

          @if (pedidoOk) {
            <p class="pixel text-neon-green pedido-ok blink">✓ ¡PEDIDO ENVIADO!</p>
          } @else {
            <button class="btn-neon btn-confirmar" [disabled]="enviando" (click)="confirmarPedido()">
              @if (enviando) { <span class="blink">PROCESANDO...</span> }
              @else { CONFIRMAR PEDIDO }
            </button>
          }

          <button class="btn-vaciar" (click)="carritoSvc.vaciar()">VACIAR CARRITO</button>
        </div>
      }
    </aside>
  `,
  styles: [`
    .carrito-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      z-index: 200; backdrop-filter: blur(2px);
    }
    .carrito-panel {
      position: fixed; top: 0; right: 0; height: 100vh; width: 360px;
      background: var(--fnaf-surface);
      border-left: 1px solid var(--fnaf-border);
      box-shadow: -4px 0 30px rgba(0,0,0,0.5);
      z-index: 300; display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(.4,0,.2,1);
    }
    .carrito-abierto { transform: translateX(0); }

    .carrito-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1.2rem 1.5rem;
      border-bottom: 1px solid var(--fnaf-border);
      background: rgba(0,245,255,0.04);
    }
    .carrito-header h2 { margin: 0; font-size: 1.3rem; }
    .btn-cerrar {
      background: transparent; border: 1px solid var(--fnaf-border);
      color: var(--fnaf-muted); cursor: pointer; font-size: 1rem; padding: 0.2rem 0.6rem;
      transition: color 0.2s, border-color 0.2s;
    }
    .btn-cerrar:hover { color: var(--fnaf-red); border-color: var(--fnaf-red); }

    .carrito-items { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }

    .carrito-vacio { text-align: center; padding: 3rem 1rem; }
    .carrito-hint { color: var(--fnaf-muted); font-size: 0.85rem; }

    .carrito-item {
      background: var(--fnaf-surface2); border: 1px solid var(--fnaf-border);
      padding: 0.75rem; border-radius: 3px;
      display: flex; flex-direction: column; gap: 0.5rem;
    }
    .item-info { display: flex; justify-content: space-between; align-items: flex-start; }
    .item-nombre { margin: 0; font-size: 0.9rem; font-weight: 600; flex: 1; }
    .item-precio { margin: 0; font-size: 1rem; }
    .item-controles { display: flex; align-items: center; gap: 0.5rem; }
    .btn-ctrl {
      background: transparent; border: 1px solid var(--fnaf-border);
      color: var(--fnaf-cyan); width: 26px; height: 26px;
      cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .btn-ctrl:hover { background: rgba(0,245,255,0.1); }
    .item-cant { font-size: 1rem; min-width: 24px; text-align: center; color: var(--fnaf-text); }
    .btn-quitar {
      background: transparent; border: none; cursor: pointer;
      font-size: 0.9rem; margin-left: auto; opacity: 0.5;
      transition: opacity 0.2s;
    }
    .btn-quitar:hover { opacity: 1; }

    .carrito-footer {
      padding: 1.2rem 1.5rem;
      border-top: 1px solid var(--fnaf-border);
      background: rgba(181,79,255,0.03);
      display: flex; flex-direction: column; gap: 0.75rem;
    }
    .total-row { display: flex; justify-content: space-between; align-items: center; }
    .total-label { font-size: 1.1rem; color: var(--fnaf-muted); }
    .total-valor { font-size: 1.8rem; }
    .btn-confirmar { width: 100%; font-size: 1rem; padding: 0.8rem; }
    .btn-confirmar:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-vaciar {
      background: transparent; border: 1px solid var(--fnaf-border);
      color: var(--fnaf-muted); font-family: var(--font-pixel);
      font-size: 0.8rem; padding: 0.4rem; cursor: pointer; width: 100%;
      transition: color 0.2s, border-color 0.2s;
    }
    .btn-vaciar:hover { color: var(--fnaf-red); border-color: var(--fnaf-red); }
    .pedido-ok { text-align: center; font-size: 1.1rem; }
  `]
})
export class CarritoComponent {
  carritoSvc = inject(CarritoService);
  pedidoSvc  = inject(PedidoService);
  enviando   = false;
  pedidoOk   = false;

  confirmarPedido() {
    if (this.carritoSvc.carrito().items.length === 0) return;
    this.enviando = true;
    const pedido = {
      usuarioId:    'usuario-local',
      emailUsuario: 'usuario@fazbear.com',
      items: this.carritoSvc.carrito().items.map(i => ({
        productoId:     i.productoId,
        nombreProducto: i.nombreProducto,
        cantidad:       i.cantidad,
        precioUnitario: i.precioUnitario
      }))
    };
    this.pedidoSvc.crear(pedido).subscribe({
      next: () => {
        this.enviando  = false;
        this.pedidoOk  = true;
        this.carritoSvc.vaciar();
        setTimeout(() => { this.pedidoOk = false; this.carritoSvc.cerrarCarrito(); }, 2500);
      },
      error: () => { this.enviando = false; }
    });
  }
}
