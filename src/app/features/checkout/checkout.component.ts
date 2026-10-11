import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CarritoService } from '../../core/services/carrito.service';
import { OrdenService } from '../../core/services/orden.service';
import { MsalService } from '@azure/msal-angular';
import { NavbarComponent } from '../../shared/navbar/navbar.component';

type MetodoPago = 'TARJETA' | 'FAZCOINS' | 'EFECTIVO';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NavbarComponent],
  template: `
    <app-navbar />

    <main class="checkout-main">
      <header class="checkout-header">
        <h1 class="pixel text-neon-cyan">💳 TERMINAL DE PAGO FAZBEAR</h1>
        <p class="checkout-sub">Completa los datos de pago para confirmar tu pedido en Freddy Fazbear's Pizza</p>
      </header>

      <!-- PANTALLA DE ÉXITO -->
      @if (pagoExitoso) {
        <div class="success-card">
          <div class="success-icon pixel blink">✓</div>
          <h2 class="pixel text-neon-green">¡PAGO APROBADO CON ÉXITO!</h2>
          <p class="success-id pixel text-neon-cyan">PEDIDO #{{ pedidoIdGenerado }} REGISTRADO</p>
          <div class="success-details">
            <p><strong>Monto Pagado:</strong> \${{ montoPagado.toFixed(2) }}</p>
            <p><strong>Método:</strong> {{ metodoSeleccionado }}</p>
            <p><strong>Ubicación de Entrega:</strong> {{ ubicacion }}</p>
            <p class="email-notice">
              ✉️ Se envió un correo de confirmación a:
              <span class="user-email">{{ emailUsuario }}</span>
            </p>
          </div>
          <div class="success-actions">
            <a routerLink="/pedidos" class="btn-neon btn-neon-green">📋 VER MIS PEDIDOS</a>
            <a routerLink="/catalogo" class="btn-neon btn-neon-cyan">🍕 VOLVER AL MENÚ</a>
          </div>
        </div>
      }

      <!-- SI EL CARRITO ESTÁ VACÍO Y NO HAY PAGO -->
      @else if (carritoSvc.carrito().items.length === 0) {
        <div class="empty-card">
          <p class="pixel text-neon-purple">[ NO HAY PRODUCTOS PARA PAGAR ]</p>
          <p class="empty-sub">Tu carrito está vacío. Agrega pizzas y artículos antes de pagar.</p>
          <a routerLink="/catalogo" class="btn-neon btn-neon-cyan">← IR AL CATÁLOGO</a>
        </div>
      }

      <!-- PANTALLA PRINCIPAL DE PAGO -->
      @else {
        <div class="checkout-grid">
          
          <!-- COLUMNA IZQUIERDA: MÉTODOS DE PAGO Y FORMULARIO -->
          <div class="payment-col">
            
            <!-- Selector de Métodos -->
            <div class="section-box">
              <h3 class="pixel section-title text-neon-purple">1. SELECCIONA EL MÉTODO DE PAGO</h3>
              <div class="metodos-grid">
                <button
                  type="button"
                  class="metodo-btn"
                  [class.activo]="metodoSeleccionado === 'TARJETA'"
                  (click)="metodoSeleccionado = 'TARJETA'">
                  <span class="metodo-icon">💳</span>
                  <span class="metodo-name">Faz-Card / Tarjeta</span>
                </button>

                <button
                  type="button"
                  class="metodo-btn"
                  [class.activo]="metodoSeleccionado === 'FAZCOINS'"
                  (click)="metodoSeleccionado = 'FAZCOINS'">
                  <span class="metodo-icon">🪙</span>
                  <span class="metodo-name">Faz-Coins</span>
                </button>

                <button
                  type="button"
                  class="metodo-btn"
                  [class.activo]="metodoSeleccionado === 'EFECTIVO'"
                  (click)="metodoSeleccionado = 'EFECTIVO'">
                  <span class="metodo-icon">💵</span>
                  <span class="metodo-name">En Caja / Efectivo</span>
                </button>
              </div>
            </div>

            <!-- Formulario: Tarjeta -->
            @if (metodoSeleccionado === 'TARJETA') {
              <div class="section-box">
                <h3 class="pixel section-title text-neon-cyan">DATOS DE LA TARJETA</h3>
                
                <!-- Mockup de Tarjeta Fazbear -->
                <div class="faz-card-preview">
                  <div class="card-chip"></div>
                  <div class="card-brand pixel">FAZBEAR PAY</div>
                  <div class="card-number pixel">
                    {{ formatearNumeroTarjeta(numeroTarjeta) || '•••• •••• •••• ••••' }}
                  </div>
                  <div class="card-bottom">
                    <div>
                      <span class="card-lbl">TITULAR</span>
                      <span class="card-val">{{ titular || 'FREDDY FAZBEAR' }}</span>
                    </div>
                    <div>
                      <span class="card-lbl">EXP</span>
                      <span class="card-val">{{ expiracion || 'MM/AA' }}</span>
                    </div>
                  </div>
                </div>

                <div class="form-grid">
                  <div class="form-group full">
                    <label>NÚMERO DE TARJETA</label>
                    <input
                      type="text"
                      class="fnaf-input"
                      placeholder="1234 5678 9012 3456"
                      maxlength="19"
                      [(ngModel)]="numeroTarjeta"
                      (input)="onNumeroInput()" />
                  </div>
                  <div class="form-group full">
                    <label>NOMBRE DEL TITULAR</label>
                    <input
                      type="text"
                      class="fnaf-input"
                      placeholder="Nombre como aparece en la tarjeta"
                      [(ngModel)]="titular" />
                  </div>
                  <div class="form-group half">
                    <label>VENCIMIENTO</label>
                    <input
                      type="text"
                      class="fnaf-input"
                      placeholder="MM/AA"
                      maxlength="5"
                      [(ngModel)]="expiracion" />
                  </div>
                  <div class="form-group half">
                    <label>CVV / CVC</label>
                    <input
                      type="password"
                      class="fnaf-input"
                      placeholder="123"
                      maxlength="4"
                      [(ngModel)]="cvv" />
                  </div>
                </div>
              </div>
            }

            <!-- Mensaje: FazCoins -->
            @if (metodoSeleccionado === 'FAZCOINS') {
              <div class="section-box fazcoins-box">
                <div class="coin-badge pixel">🪙 FAZ-COINS DISPONIBLES: 1,500 Fz</div>
                <p>Se descontarán <strong>\${{ carritoSvc.carrito().total.toFixed(2) }} Faz-Coins</strong> directamente de tu saldo de cliente frecuente.</p>
                <p class="sub-hint">¡Recibes un 5% de cashback en tokens Fazbear con cada orden!</p>
              </div>
            }

            <!-- Mensaje: Efectivo -->
            @if (metodoSeleccionado === 'EFECTIVO') {
              <div class="section-box">
                <h3 class="pixel section-title text-neon-yellow">💵 PAGO EN CAJA O REPARTO</h3>
                <p>El pedido quedará registrado en estado <strong>PENDIENTE</strong>. Realizarás el pago en efectivo directamente al anfitrión animatrónico al recibir la orden.</p>
              </div>
            }

            <!-- Ubicación de Entrega -->
            <div class="section-box">
              <h3 class="pixel section-title text-neon-purple">2. UBICACIÓN DE ENTREGA</h3>
              <div class="form-group full">
                <label>SECTOR / MESA</label>
                <select class="fnaf-input" [(ngModel)]="ubicacion">
                  <option value="Mesa Show Stage #1">Mesa Show Stage #1 (Junto a Freddy)</option>
                  <option value="Mesa Show Stage #4">Mesa Show Stage #4</option>
                  <option value="Pirate Cove Box #2">Pirate Cove Box #2 (Junto a Foxy)</option>
                  <option value="Arcade Zone Mesa #7">Arcade Zone Mesa #7</option>
                  <option value="Para Llevar / Takeaway">Para Llevar / Retiro en Mostrador</option>
                  <option value="Delivery Fazbear Express">Delivery Fazbear Express a Domicilio</option>
                </select>
              </div>
            </div>

          </div>

          <!-- COLUMNA DERECHA: RESUMEN DE LA ORDEN -->
          <div class="summary-col">
            <div class="section-box summary-box">
              <h3 class="pixel section-title text-neon-green">📋 RESUMEN DE LA ORDEN</h3>
              
              <div class="items-list">
                @for (item of carritoSvc.carrito().items; track item.productoId) {
                  <div class="summary-item">
                    <div class="item-desc">
                      <span class="item-name">{{ item.nombreProducto }}</span>
                      <span class="item-qty">x{{ item.cantidad }}</span>
                    </div>
                    <span class="item-subtotal pixel text-neon-green">
                      \${{ (item.precioUnitario * item.cantidad).toFixed(2) }}
                    </span>
                  </div>
                }
              </div>

              <div class="divider"></div>

              <div class="calc-row">
                <span>Subtotal</span>
                <span>\${{ carritoSvc.carrito().total.toFixed(2) }}</span>
              </div>
              <div class="calc-row">
                <span>Tarifa de Servicio Fazbear</span>
                <span class="text-neon-cyan">GRATIS</span>
              </div>
              <div class="calc-row total-row">
                <span class="pixel">TOTAL A PAGAR:</span>
                <span class="pixel text-neon-green total-amount">
                  \${{ carritoSvc.carrito().total.toFixed(2) }}
                </span>
              </div>

              @if (errorMsg) {
                <div class="error-box pixel">
                  ⚠ {{ errorMsg }}
                </div>
              }

              <button
                id="btn-confirmar-pago"
                type="button"
                class="btn-neon btn-pagar pixel"
                [disabled]="procesando"
                (click)="procesarPago()">
                @if (procesando) {
                  <span class="blink">⚙ PROCESANDO PAGO...</span>
                } @else {
                  <span>💳 PAGAR \${{ carritoSvc.carrito().total.toFixed(2) }}</span>
                }
              </button>

              <p class="security-text">
                🔒 Transacción asegurada por Fazbear Security Systems & AWS Gateway
              </p>
            </div>
          </div>

        </div>
      }
    </main>
  `,
  styles: [`
    .checkout-main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }
    .checkout-header {
      margin-bottom: 2rem;
      text-align: center;
    }
    .checkout-header h1 {
      font-size: clamp(1.4rem, 4vw, 2.2rem);
      margin: 0 0 0.5rem;
    }
    .checkout-sub {
      color: var(--fnaf-muted);
      font-size: 0.9rem;
      margin: 0;
    }

    .checkout-grid {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 2rem;
      align-items: start;
    }
    @media (max-width: 860px) {
      .checkout-grid {
        grid-template-columns: 1fr;
      }
    }

    .section-box {
      background: var(--fnaf-surface);
      border: 1px solid var(--fnaf-border);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border-radius: 4px;
    }
    .section-title {
      font-size: 0.95rem;
      margin: 0 0 1.2rem;
    }

    /* Selector de métodos */
    .metodos-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }
    .metodo-btn {
      background: var(--fnaf-surface2);
      border: 1px solid var(--fnaf-border);
      color: var(--fnaf-text);
      padding: 1rem 0.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .metodo-btn:hover {
      border-color: var(--fnaf-cyan);
    }
    .metodo-btn.activo {
      border-color: var(--fnaf-purple);
      background: rgba(181, 79, 255, 0.12);
      box-shadow: 0 0 10px rgba(181, 79, 255, 0.3);
    }
    .metodo-icon {
      font-size: 1.6rem;
    }
    .metodo-name {
      font-size: 0.8rem;
      font-weight: 600;
      text-align: center;
    }

    /* Preview de Tarjeta Fazbear */
    .faz-card-preview {
      background: linear-gradient(135deg, #1b003a 0%, #3d0075 50%, #002244 100%);
      border: 1px solid var(--fnaf-purple);
      border-radius: 12px;
      padding: 1.4rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 8px 24px rgba(181, 79, 255, 0.25);
      position: relative;
      overflow: hidden;
    }
    .faz-card-preview::after {
      content: '🐻';
      position: absolute;
      right: 15px;
      top: 15px;
      font-size: 3rem;
      opacity: 0.15;
    }
    .card-chip {
      width: 40px;
      height: 28px;
      background: linear-gradient(135deg, #ffd700, #b8860b);
      border-radius: 4px;
      margin-bottom: 1rem;
    }
    .card-brand {
      position: absolute;
      top: 1.4rem;
      right: 1.4rem;
      font-size: 0.85rem;
      color: var(--fnaf-cyan);
    }
    .card-number {
      font-size: 1.15rem;
      letter-spacing: 2px;
      color: #fff;
      margin-bottom: 1rem;
    }
    .card-bottom {
      display: flex;
      justify-content: space-between;
    }
    .card-lbl {
      display: block;
      font-size: 0.65rem;
      color: var(--fnaf-muted);
    }
    .card-val {
      font-size: 0.85rem;
      color: #fff;
      font-weight: 600;
    }

    /* Form Inputs */
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    .form-group.full { grid-column: span 2; }
    .form-group.half { grid-column: span 1; }
    .form-group label {
      display: block;
      font-size: 0.75rem;
      color: var(--fnaf-muted);
      margin-bottom: 0.4rem;
      font-weight: 600;
    }
    .fnaf-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--fnaf-surface2);
      border: 1px solid var(--fnaf-border);
      color: var(--fnaf-text);
      padding: 0.7rem 0.9rem;
      border-radius: 3px;
      font-size: 0.9rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .fnaf-input:focus {
      outline: none;
      border-color: var(--fnaf-cyan);
      box-shadow: 0 0 8px rgba(0, 245, 255, 0.3);
    }

    /* FazCoins */
    .fazcoins-box {
      border-color: var(--fnaf-yellow);
      background: rgba(255, 215, 0, 0.04);
    }
    .coin-badge {
      font-size: 1.1rem;
      color: var(--fnaf-yellow);
      margin-bottom: 0.8rem;
    }
    .sub-hint {
      color: var(--fnaf-muted);
      font-size: 0.8rem;
      margin-top: 0.5rem;
    }

    /* Columna Resumen */
    .summary-box {
      border-color: var(--fnaf-green);
      position: sticky;
      top: 90px;
    }
    .items-list {
      max-height: 250px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      margin-bottom: 1rem;
    }
    .summary-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .item-desc {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .item-name {
      font-size: 0.85rem;
    }
    .item-qty {
      font-size: 0.75rem;
      color: var(--fnaf-muted);
    }
    .item-subtotal {
      font-size: 0.9rem;
    }

    .divider {
      height: 1px;
      background: var(--fnaf-border);
      margin: 1rem 0;
    }
    .calc-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      color: var(--fnaf-muted);
      margin-bottom: 0.5rem;
    }
    .calc-row.total-row {
      margin-top: 1rem;
      padding-top: 0.8rem;
      border-top: 1px dashed var(--fnaf-border);
      color: var(--fnaf-text);
      align-items: center;
    }
    .total-amount {
      font-size: 1.6rem;
    }

    .btn-pagar {
      width: 100%;
      padding: 0.9rem;
      font-size: 1rem;
      margin-top: 1.5rem;
      background: var(--fnaf-green);
      color: #000;
      font-weight: bold;
      border: none;
      cursor: pointer;
      box-shadow: 0 0 15px rgba(57, 255, 20, 0.4);
      transition: all 0.2s;
    }
    .btn-pagar:hover:not(:disabled) {
      box-shadow: 0 0 25px rgba(57, 255, 20, 0.7);
      transform: translateY(-1px);
    }
    .btn-pagar:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .security-text {
      font-size: 0.7rem;
      color: var(--fnaf-muted);
      text-align: center;
      margin: 1rem 0 0;
    }
    .error-box {
      margin-top: 1rem;
      padding: 0.75rem;
      background: rgba(255, 77, 77, 0.15);
      border: 1px solid var(--fnaf-red);
      color: var(--fnaf-red);
      font-size: 0.8rem;
      text-align: center;
    }

    /* Tarjeta de Éxito */
    .success-card, .empty-card {
      max-width: 600px;
      margin: 3rem auto;
      background: var(--fnaf-surface);
      border: 1px solid var(--fnaf-border);
      padding: 3rem 2rem;
      text-align: center;
      border-radius: 6px;
    }
    .success-card {
      border-color: var(--fnaf-green);
      box-shadow: 0 0 30px rgba(57, 255, 20, 0.15);
    }
    .success-icon {
      font-size: 3.5rem;
      color: var(--fnaf-green);
      margin-bottom: 1rem;
    }
    .success-id {
      font-size: 1.2rem;
      margin-bottom: 1.5rem;
    }
    .success-details {
      background: var(--fnaf-surface2);
      border: 1px solid var(--fnaf-border);
      padding: 1.2rem;
      margin-bottom: 2rem;
      text-align: left;
      font-size: 0.9rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .email-notice {
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--fnaf-border);
      color: var(--fnaf-cyan);
    }
    .user-email {
      font-weight: bold;
      color: #fff;
    }
    .success-actions {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .empty-card {
      border-color: var(--fnaf-purple);
    }
    .empty-sub {
      color: var(--fnaf-muted);
      margin: 1rem 0 2rem;
    }
  `]
})
export class CheckoutComponent implements OnInit {
  carritoSvc = inject(CarritoService);
  private ordenSvc = inject(OrdenService);
  private msalSvc = inject(MsalService);
  private router = inject(Router);

  metodoSeleccionado: MetodoPago = 'TARJETA';
  numeroTarjeta = '';
  titular = '';
  expiracion = '';
  cvv = '';
  ubicacion = 'Mesa Show Stage #1';

  procesando = false;
  pagoExitoso = false;
  pedidoIdGenerado: number | null = null;
  montoPagado = 0;
  emailUsuario = '';
  errorMsg = '';

  ngOnInit() {
    const cuenta = this.msalSvc.instance.getAllAccounts()[0];
    this.emailUsuario = cuenta?.username ?? 'cliente@fazbear.com';
    this.titular = cuenta?.name || this.emailUsuario.split('@')[0].toUpperCase();
  }

  onNumeroInput() {
    // Formatear automáticamente en grupos de 4 dígitos
    let val = this.numeroTarjeta.replace(/\D/g, '').substring(0, 16);
    let chunks = val.match(/.{1,4}/g);
    this.numeroTarjeta = chunks ? chunks.join(' ') : val;
  }

  formatearNumeroTarjeta(num: string): string {
    return num;
  }

  procesarPago() {
    if (this.carritoSvc.carrito().items.length === 0) {
      this.errorMsg = 'El carrito está vacío';
      return;
    }

    if (this.metodoSeleccionado === 'TARJETA') {
      const numSinEspacio = this.numeroTarjeta.replace(/\s/g, '');
      if (numSinEspacio.length < 15) {
        this.errorMsg = 'Por favor ingresa un número de tarjeta válido';
        return;
      }
      if (!this.expiracion || this.expiracion.length < 4) {
        this.errorMsg = 'Por favor ingresa la fecha de vencimiento (MM/AA)';
        return;
      }
      if (!this.cvv || this.cvv.length < 3) {
        this.errorMsg = 'Por favor ingresa el código de seguridad CVV';
        return;
      }
    }

    this.procesando = true;
    this.errorMsg = '';
    const cuenta = this.msalSvc.instance.getAllAccounts()[0];

    const payload = {
      usuarioId: cuenta?.localAccountId ?? 'anonimo',
      emailUsuario: this.emailUsuario,
      items: this.carritoSvc.carrito().items.map(i => ({
        productoId: i.productoId,
        nombreProducto: i.nombreProducto,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario
      }))
    };

    this.montoPagado = this.carritoSvc.carrito().total;

    this.ordenSvc.confirmar(payload).subscribe({
      next: (res: any) => {
        this.procesando = false;
        this.pagoExitoso = true;
        this.pedidoIdGenerado = res?.pedidoId ?? Math.floor(1000 + Math.random() * 9000);
        this.carritoSvc.vaciar();
      },
      error: (err) => {
        this.procesando = false;
        if (err.status === 503) {
          this.errorMsg = 'Servicio de órdenes no disponible (503). Asegúrate de que el microservicio ms-orden esté encendido en su EC2.';
        } else {
          this.errorMsg = `Error al procesar el pago y la orden (${err.status || 'Red'}). Intenta nuevamente.`;
        }
      }
    });
  }
}
