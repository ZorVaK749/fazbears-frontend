import { Component, OnInit, inject } from '@angular/core';
import { ProductoService, Producto } from '../../core/services/producto.service';
import { CarritoService } from '../../core/services/carrito.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { CarritoComponent } from '../cart/carrito.component';

type Categoria = 'TODOS' | 'PIZZA' | 'BEBIDA' | 'SOUVENIR' | 'ANIMATRONICO';

interface CategoriaTab {
  id: Categoria;
  label: string;
  emoji: string;
}


@Component({
  selector: 'app-catalogo',
  standalone: true,
  imports: [NavbarComponent, CarritoComponent],
  template: `
    <app-navbar />

    <main class="catalogo-main">
      <!-- Header -->
      <header class="catalogo-header">
        <h1 class="pixel text-neon-yellow catalogo-title">MENÚ DEL ESTABLECIMIENTO</h1>
        <p class="catalogo-sub">Seleccione sus productos — Freddy Fazbear's Pizza &copy; 1987</p>
      </header>

      <!-- Tabs de categoría -->
      <div class="tabs-container">
        @for (tab of tabs; track tab.id) {
          <button
            class="tab-btn pixel"
            [class.tab-active]="categoriaActiva === tab.id"
            (click)="filtrar(tab.id)">
            {{ tab.emoji }} {{ tab.label }}
          </button>
        }
      </div>

      <!-- Estado de carga -->
      @if (cargando) {
        <div class="estado-centro">
          <p class="pixel text-neon-cyan blink">[ CARGANDO MENÚ... ]</p>
        </div>
      }

      @if (error) {
        <div class="estado-centro">
          <p class="pixel text-neon-red">⚠ ERROR: No se pudo conectar con el servidor</p>
          <p class="error-hint">¿Está corriendo el MS Productos en localhost:8081?</p>
          <button class="btn-neon" (click)="cargarProductos()">REINTENTAR</button>
        </div>
      }

      <!-- Grid de productos -->
      @if (!cargando && !error) {
        <div class="productos-grid">
          @for (producto of productosFiltrados; track producto.id) {
            <div class="producto-card card-fnaf">
              <!-- Imagen placeholder temático por categoría -->
              <div class="producto-img" [class]="'img-' + producto.categoria.toLowerCase()">
                <span class="producto-emoji">{{ emojiCategoria(producto.categoria) }}</span>
                <span class="producto-cat-badge pixel">{{ producto.categoria }}</span>
              </div>

              <!-- Info -->
              <div class="producto-info">
                <h3 class="producto-nombre">{{ producto.nombre }}</h3>
                <p class="producto-desc">{{ producto.descripcion }}</p>
                <div class="producto-footer">
                  <span class="producto-precio pixel text-neon-green">
                    {{ '$' + producto.precio }}
                  </span>
                  <button class="btn-neon btn-neon-cyan btn-add"
                    (click)="agregar(producto)">
                    + AÑADIR
                  </button>
                </div>
              </div>
            </div>
          }

          @empty {
            <div class="estado-centro">
              <p class="pixel text-neon-purple">[ SIN PRODUCTOS EN ESTA CATEGORÍA ]</p>
            </div>
          }
        </div>
      }
    </main>

    <!-- Panel carrito -->
    <app-carrito />
  `,
  styles: [`
    .catalogo-main {
      max-width: 1400px; margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    .catalogo-header { text-align: center; margin-bottom: 2.5rem; }
    .catalogo-title { font-size: clamp(1.5rem, 4vw, 2.5rem); margin: 0 0 0.5rem; }
    .catalogo-sub { color: var(--fnaf-muted); font-size: 0.85rem; margin: 0; }

    /* Tabs */
    .tabs-container {
      display: flex; flex-wrap: wrap; gap: 0.5rem;
      justify-content: center; margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--fnaf-border);
      padding-bottom: 1rem;
    }
    .tab-btn {
      background: transparent; border: 1px solid var(--fnaf-border);
      color: var(--fnaf-muted); padding: 0.4rem 1.2rem;
      cursor: pointer; font-size: 0.9rem; letter-spacing: 1px;
      transition: all 0.2s;
    }
    .tab-btn:hover { color: var(--fnaf-text); border-color: var(--fnaf-purple); }
    .tab-active {
      color: var(--fnaf-cyan) !important;
      border-color: var(--fnaf-cyan) !important;
      box-shadow: 0 0 10px rgba(0,245,255,0.3);
    }

    /* Grid */
    .productos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.5rem;
    }

    .producto-card {
      display: flex; flex-direction: column; border-radius: 4px; overflow: hidden;
    }

    /* Imagen / Placeholder por categoría */
    .producto-img {
      height: 160px; display: flex; align-items: center; justify-content: center;
      position: relative; flex-direction: column; gap: 0.5rem;
    }
    .img-pizza      { background: linear-gradient(135deg, #1a0a2e, #2d0a3a); }
    .img-bebida     { background: linear-gradient(135deg, #0a1a2e, #0a2d3a); }
    .img-souvenir   { background: linear-gradient(135deg, #1a1a0a, #2d2a0a); }
    .img-animatronico { background: linear-gradient(135deg, #1a0a0a, #3a0a1a); }

    .producto-emoji { font-size: 4rem; }
    .producto-cat-badge {
      position: absolute; top: 8px; right: 8px;
      font-size: 0.65rem; padding: 2px 8px;
      background: rgba(181,79,255,0.2); color: var(--fnaf-purple);
      border: 1px solid var(--fnaf-purple-dim);
    }

    /* Info */
    .producto-info { padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; flex: 1; }
    .producto-nombre { font-size: 1rem; font-weight: 600; margin: 0; color: var(--fnaf-text); }
    .producto-desc {
      font-size: 0.82rem; color: var(--fnaf-muted); margin: 0;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .producto-footer { display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 0.5rem; }
    .producto-precio { font-size: 1.3rem; }
    .btn-add { font-size: 0.8rem; padding: 0.35rem 0.9rem; clip-path: none; }

    /* Estados */
    .estado-centro { grid-column: 1/-1; text-align: center; padding: 4rem 1rem; }
    .text-neon-red { color: var(--fnaf-red); text-shadow: 0 0 8px var(--fnaf-red); }
    .error-hint { color: var(--fnaf-muted); font-size: 0.85rem; margin: 0.5rem 0 1.5rem; }
  `]
})
export class CatalogoComponent implements OnInit {
  private productoSvc = inject(ProductoService);
  private carritoSvc = inject(CarritoService);

  todos: Producto[] = [];
  productosFiltrados: Producto[] = [];
  categoriaActiva: Categoria = 'TODOS';
  cargando = true;
  error = false;

  tabs: CategoriaTab[] = [
    { id: 'TODOS', label: 'TODOS', emoji: '📋' },
    { id: 'PIZZA', label: 'PIZZAS', emoji: '🍕' },
    { id: 'BEBIDA', label: 'BEBIDAS', emoji: '🥤' },
    { id: 'SOUVENIR', label: 'SOUVENIRS', emoji: '🎭' },
    { id: 'ANIMATRONICO', label: 'ANIMATRÓNICOS', emoji: '🤖' },
  ];

  ngOnInit() { this.cargarProductos(); }

  cargarProductos() {
    this.cargando = true; this.error = false;
    this.productoSvc.getAll().subscribe({
      next: (data) => {
        this.todos = data;
        this.productosFiltrados = data;
        this.cargando = false;
      },
      error: () => { this.cargando = false; this.error = true; }
    });
  }

  filtrar(cat: Categoria) {
    this.categoriaActiva = cat;
    this.productosFiltrados = cat === 'TODOS'
      ? this.todos
      : this.todos.filter(p => p.categoria === cat);
  }

  agregar(producto: Producto) {
    this.carritoSvc.agregarProducto(producto);
  }

  emojiCategoria(cat: string): string {
    const map: Record<string, string> = {
      PIZZA: '🍕', BEBIDA: '🥤', SOUVENIR: '🎭', ANIMATRONICO: '🤖'
    };
    return map[cat] ?? '📦';
  }
}
