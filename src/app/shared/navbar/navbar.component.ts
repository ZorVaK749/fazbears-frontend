import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CarritoService } from '../../core/services/carrito.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="navbar">
      <!-- Logo -->
      <a routerLink="/catalogo" class="navbar-logo">
        <span class="pixel text-neon-yellow">🍕 FREDDY</span>
        <span class="pixel navbar-subtitle">FAZBEAR'S PIZZA</span>
      </a>

      <!-- Links -->
      <div class="navbar-links">
        <a routerLink="/catalogo" routerLinkActive="nav-active" class="nav-link pixel">
          MENÚ
        </a>
        <a routerLink="/pedidos" routerLinkActive="nav-active" class="nav-link pixel">
          MIS PEDIDOS
        </a>
      </div>

      <!-- Botón carrito -->
      <button class="btn-carrito" (click)="carritoSvc.toggleCarrito()">
        <span class="pixel text-neon-cyan">🛒 CARRITO</span>
        @if (carritoSvc.cantidadItems > 0) {
          <span class="carrito-badge">{{ carritoSvc.cantidadItems }}</span>
        }
      </button>
    </nav>
  `,
  styles: [`
    .navbar {
      position: sticky; top: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.8rem 2rem;
      background: rgba(10,10,15,0.92);
      border-bottom: 1px solid var(--fnaf-border);
      box-shadow: 0 2px 20px rgba(181,79,255,0.15);
      backdrop-filter: blur(10px);
    }
    .navbar-logo { text-decoration: none; display: flex; flex-direction: column; line-height: 1.1; }
    .navbar-logo .pixel { font-size: 1.4rem; }
    .navbar-subtitle { font-size: 0.65rem; color: var(--fnaf-muted); letter-spacing: 3px; }
    .navbar-links { display: flex; gap: 2rem; }
    .nav-link {
      color: var(--fnaf-muted); text-decoration: none; font-size: 1rem;
      padding: 0.3rem 0.5rem; border-bottom: 2px solid transparent;
      transition: color 0.2s, border-color 0.2s;
    }
    .nav-link:hover, .nav-active { color: var(--fnaf-cyan); border-bottom-color: var(--fnaf-cyan); }
    .btn-carrito {
      position: relative; background: transparent; border: 1px solid var(--fnaf-cyan);
      padding: 0.4rem 1rem; cursor: pointer;
      transition: box-shadow 0.2s, background 0.2s;
    }
    .btn-carrito:hover { background: rgba(0,245,255,0.08); box-shadow: 0 0 12px var(--fnaf-cyan); }
    .carrito-badge {
      position: absolute; top: -8px; right: -8px;
      background: var(--fnaf-purple); color: white;
      font-family: var(--font-pixel); font-size: 0.85rem;
      border-radius: 50%; width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 8px var(--fnaf-purple);
    }
  `]
})
export class NavbarComponent {
  carritoSvc = inject(CarritoService);
}
