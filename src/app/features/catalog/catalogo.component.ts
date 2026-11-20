import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ProductoService, Producto } from '../../core/services/producto.service';
import { CarritoService } from '../../core/services/carrito.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { RecomendacionesComponent } from '../../shared/recomendaciones/recomendaciones.component';
import { RecomendacionesService } from '../../core/services/recomendaciones.service';
import { ProductoCardComponent } from '../../shared/producto-card.component';

type Categoria = 'TODOS' | 'PIZZA' | 'BEBIDA' | 'SOUVENIR' | 'ANIMATRONICO';

interface CategoriaTab {
  id: Categoria;
  label: string;
  emoji: string;
}


@Component({
  selector: 'app-catalogo',
  standalone: true,
  imports: [NavbarComponent, RecomendacionesComponent, ProductoCardComponent],
  template: `
    <app-navbar />

    <main class="catalogo-main">
      <header class="catalogo-header">
        <h1 class="pixel text-neon-yellow catalogo-title">Menú</h1>
      </header>

      <app-recomendaciones />
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
        <div class="estado-centro" role="alert">
          <p class="pixel text-neon-red">No se pudo cargar el catálogo</p>
          <p class="error-hint">{{ error }}</p>
          <button class="btn-neon" (click)="cargarProductos()">REINTENTAR</button>
        </div>
      }

      <!-- Grid de productos -->
      @if (!cargando && !error) {
        <div class="productos-grid">
          @for (producto of productosFiltrados; track producto.id) {
            <app-producto-card [producto]="producto" (ver)="ver(producto)" (agregar)="agregar(producto)" />
          }

          @empty {
            <div class="estado-centro">
              <p class="pixel text-neon-purple">[ SIN PRODUCTOS EN ESTA CATEGORÍA ]</p>
            </div>
          }
        </div>
      }
    </main>
  `,
  styles: [`
    .catalogo-main {
      max-width: 1400px; margin: 0 auto;
      padding: clamp(1rem, 3vw, 2rem);
    }

    .catalogo-header { margin-bottom: 1.5rem; }
    .catalogo-title { font-size: clamp(1.5rem, 4vw, 2.5rem); margin: 0 0 0.5rem; }

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
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
      gap: 1rem;
    }

    /* Estados */
    .estado-centro { grid-column: 1/-1; text-align: center; padding: 4rem 1rem; }
    .text-neon-red { color: var(--fnaf-red); text-shadow: 0 0 8px var(--fnaf-red); }
    .error-hint { color: var(--fnaf-muted); font-size: 0.85rem; margin: 0.5rem 0 1.5rem; }
  `]
})
export class CatalogoComponent implements OnInit {
  private productoSvc = inject(ProductoService);
  private carritoSvc = inject(CarritoService);
  private cdr = inject(ChangeDetectorRef);
  private recomendaciones = inject(RecomendacionesService);
  ver(producto: Producto) { this.registrar(producto.id, 'VIEW'); }
  private registrar(id: number, tipo: 'VIEW' | 'SELECT') {
    this.recomendaciones.interaccion(id, tipo).subscribe({ error: () => {
      console.warn('Interacción no registrada; no se reenvió automáticamente.');
    } });
  }

  todos: Producto[] = [];
  productosFiltrados: Producto[] = [];
  categoriaActiva: Categoria = 'TODOS';
  cargando = true;
  error = '';

  tabs: CategoriaTab[] = [
    { id: 'TODOS', label: 'TODOS', emoji: '📋' },
    { id: 'PIZZA', label: 'PIZZAS', emoji: '🍕' },
    { id: 'BEBIDA', label: 'BEBIDAS', emoji: '🥤' },
    { id: 'SOUVENIR', label: 'SOUVENIRS', emoji: '🎭' },
    { id: 'ANIMATRONICO', label: 'ANIMATRÓNICOS', emoji: '🤖' },
  ];

  ngOnInit() { this.cargarProductos(); }

  cargarProductos() {
    this.cargando = true; this.error = '';
    this.productoSvc.getAll().subscribe({
      next: (data) => {
        this.todos = data;
        this.productosFiltrados = data;
        this.cargando = false;
        this.cdr.detectChanges(); // Fix: MSAL responde fuera de Angular Zone
      },
      error: (failure: unknown) => {
        this.cargando = false;
        this.error = this.mensajeError(failure);
        this.cdr.detectChanges(); // Fix: forzar actualización en caso de error
      }
    });
  }

  private mensajeError(failure: unknown): string {
    if (failure instanceof HttpErrorResponse) {
      if (failure.status === 401) return 'Vuelve a iniciar sesión para consultar el catálogo (HTTP 401).';
      if (failure.status === 403) return 'La cuenta actual no tiene acceso al catálogo (HTTP 403).';
      if (failure.status >= 500) {
        return `El servicio de catálogo está temporalmente indisponible (HTTP ${failure.status}).`;
      }
      if (failure.status === 0) return 'No se recibió respuesta. Comprueba tu conexión y reintenta.';
    }
    return 'Reintenta para cargar los productos.';
  }

  filtrar(cat: Categoria) {
    this.categoriaActiva = cat;
    this.productosFiltrados = cat === 'TODOS'
      ? this.todos
      : this.todos.filter(p => p.categoria === cat);
  }

  agregar(producto: Producto) {
    this.registrar(producto.id, 'SELECT');
    this.carritoSvc.agregarProducto(producto);
  }

}
