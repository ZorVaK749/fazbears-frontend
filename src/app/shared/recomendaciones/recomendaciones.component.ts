import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CarritoService, IdentidadSesion } from '../../core/services/carrito.service';
import { RecomendacionesService, Recomendaciones, Recomendacion } from '../../core/services/recomendaciones.service';
import { ProductoService } from '../../core/services/producto.service';

@Component({
  selector: 'app-recomendaciones', standalone: true,
  template: `
    <section aria-label="Recomendaciones">
      <h2 class="pixel text-neon-cyan">Recomendaciones</h2>
      @if (vigente()) {
        @if (resultado(); as r) {
          <p>Estrategia: {{ r.estrategia }} · {{ r.generadoEn }}</p>
          @if (r.estrategia.startsWith('FALLBACK')) { <p>Alternativa de popularidad/catálogo; no es personalización.</p> }
          @for (item of r.items; track item.productoId) {
            <article class="card-fnaf">
              <button class="btn-neon" (click)="ver(item)">{{ item.nombre }}</button>
              <p>{{ item.categoria }} · {{ item.precio }} · {{ item.razon }}</p>
              <button class="btn-neon" (click)="seleccionar(item)">Añadir recomendado</button>
            </article>
          } @empty { <p>Sin recomendaciones disponibles; consulta el catálogo.</p> }
        }
        @if (mensaje()) { <p role="status">{{ mensaje() }}</p> }
      }
      <button class="btn-neon" (click)="cargar()">Actualizar recomendaciones</button>
    </section>
  `,
  styles: [`section { margin-bottom: 2rem; } h2 { font-size: 1rem; } article { display: inline-block; padding: 1rem; margin: .4rem; }`],
})
export class RecomendacionesComponent {
  private svc = inject(RecomendacionesService);
  private carrito = inject(CarritoService);
  private productos = inject(ProductoService);
  private destroy = inject(DestroyRef);
  private identidad?: Readonly<IdentidadSesion>;
  resultado = signal<Recomendaciones | null>(null);
  mensaje = signal('');
  constructor() {
    effect(() => {
      this.identidad = this.carrito.identidadVerificada() ?? undefined;
      this.resultado.set(null); this.mensaje.set('');
      if (this.vigente()) this.cargar();
    });
    void this.carrito.inicializar();
  }
  vigente() { return !!this.identidad && this.carrito.esIdentidadActual(this.identidad); }
  cargar() {
    const identidad = this.identidad;
    if (!identidad || !this.carrito.esIdentidadActual(identidad)) return;
    this.svc.obtener().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: r => { if (this.carrito.esIdentidadActual(identidad)) { this.resultado.set(r); this.mensaje.set(''); } },
      error: () => {
        if (this.carrito.esIdentidadActual(identidad)) {
          this.resultado.set(null); this.mensaje.set('Recomendaciones no disponibles. Alternativa: catálogo general, sin personalización.');
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
    const identidad = this.identidad!;
    this.svc.interaccion(id, tipo).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      error: () => { if (this.carrito.esIdentidadActual(identidad)) this.mensaje.set('No se pudo registrar la interacción. No se reenvió automáticamente.'); },
    });
  }
}
