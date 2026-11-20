import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CarritoService, IdentidadSesion } from '../../core/services/carrito.service';
import { RecomendacionesService, Recomendaciones, Recomendacion } from '../../core/services/recomendaciones.service';
import { ProductoService } from '../../core/services/producto.service';
import { ProductoCardComponent } from '../producto-card.component';

@Component({
  selector: 'app-recomendaciones', standalone: true,
  imports: [ProductoCardComponent],
  template: `
    @if (vigente()) {
      <section aria-labelledby="recomendaciones-titulo">
        <header>
          <h2 id="recomendaciones-titulo" class="text-neon-cyan">Recomendaciones</h2>
          <button type="button" class="payment-action" [disabled]="cargando()" (click)="cargar()">Actualizar</button>
        </header>
        @if (resultado(); as r) {
          @if (r.items.length) {
            <div class="recomendadas">
              @for (item of r.items; track item.productoId) {
                <app-producto-card class="compacta" [producto]="item" (ver)="ver(item)" (agregar)="seleccionar(item)" />
              }
            </div>
          } @else { <p>Sin recomendaciones disponibles.</p> }
        } @else if (cargando()) { <p role="status">Cargando recomendaciones…</p> }
        @if (mensaje()) { <p role="status">{{ mensaje() }}</p> }
      </section>
    }
  `,
  styleUrl: '../payment-ui.css',
  styles: [`
    section { margin-bottom: 2rem; }
    header { display: flex; justify-content: space-between; gap: .75rem; align-items: center; flex-wrap: wrap; margin-bottom: .75rem; }
    h2 { font-size: clamp(1.35rem, 3vw, 1.75rem); }
    .recomendadas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: .75rem; }
    p { color: #b5b5cb; margin-block: .5rem; }
  `],
})
export class RecomendacionesComponent {
  private svc = inject(RecomendacionesService);
  private carrito = inject(CarritoService);
  private productos = inject(ProductoService);
  private destroy = inject(DestroyRef);
  private identidad?: Readonly<IdentidadSesion>;
  resultado = signal<Recomendaciones | null>(null);
  mensaje = signal('');
  cargando = signal(false);
  constructor() {
    effect(() => {
      this.identidad = this.carrito.identidadVerificada() ?? undefined;
      this.resultado.set(null); this.mensaje.set(''); this.cargando.set(false);
      untracked(() => this.cargar());
    });
    void this.carrito.inicializar();
  }
  vigente() { return !!this.identidad && this.carrito.esIdentidadActual(this.identidad); }
  cargar() {
    const identidad = this.identidad;
    if (!identidad || !this.carrito.esIdentidadActual(identidad) || this.cargando()) return;
    this.cargando.set(true);
    this.mensaje.set('');
    this.svc.obtener().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: r => { if (this.carrito.esIdentidadActual(identidad)) { this.resultado.set(r); this.cargando.set(false); } },
      error: () => {
        if (this.carrito.esIdentidadActual(identidad)) {
          this.resultado.set(null); this.cargando.set(false); this.mensaje.set('No se pudieron cargar las recomendaciones.');
        }
      },
    });
  }
  ver(item: Recomendacion) { this.interaccion(item.productoId, 'VIEW'); }
  seleccionar(item: Recomendacion) {
    if (!this.vigente()) return;
    this.interaccion(item.productoId, 'SELECT');
    const identidad = this.identidad!;
    // Recommendation projection is eventual; refresh the actual catalog before adding.
    this.productos.getById(item.productoId).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: producto => { if (this.carrito.esIdentidadActual(identidad)) this.carrito.agregarProducto(producto); },
      error: () => { if (this.carrito.esIdentidadActual(identidad)) this.mensaje.set('Producto no disponible en el catálogo actual.'); },
    });
  }
  private interaccion(id: number, tipo: 'VIEW' | 'SELECT') {
    if (!this.vigente()) return;
    this.svc.interaccion(id, tipo).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      error: () => console.warn('No se pudo registrar una interacción de recomendaciones.'),
    });
  }
}
