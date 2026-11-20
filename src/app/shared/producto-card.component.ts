import { Component, input, output } from '@angular/core';
import { ClpPipe } from './clp.pipe';

interface ProductoVisible { nombre: string; categoria: string; precio: number; descripcion?: string; }

const categorias: Record<string, { icono: string; nombre: string }> = {
  PIZZA: { icono: '🍕', nombre: 'Pizza' }, BEBIDA: { icono: '🥤', nombre: 'Bebida' },
  SOUVENIR: { icono: '🎭', nombre: 'Souvenir' }, ANIMATRONICO: { icono: '🤖', nombre: 'Animatrónico' },
};

@Component({
  selector: 'app-producto-card', imports: [ClpPipe],
  template: `
    <article>
      <div class="producto-img" [class]="'img-' + producto().categoria.toLowerCase()">
        <span class="icono" aria-hidden="true">{{ categoria.icono }}</span>
        <span class="categoria">{{ categoria.nombre }}</span>
      </div>
      <div class="info">
        <h3><button type="button" class="titulo" (click)="ver.emit()">{{ producto().nombre }}</button></h3>
        @if (producto().descripcion) { <p>{{ producto().descripcion }}</p> }
        <div class="pie">
          <strong>{{ producto().precio | clp }}</strong>
          <button type="button" class="anadir" (click)="agregar.emit()"
                  [attr.aria-label]="'Añadir ' + producto().nombre">Añadir</button>
        </div>
      </div>
    </article>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    article { display: flex; flex-direction: column; height: 100%; overflow: hidden; border: 1px solid var(--fnaf-border); border-radius: .55rem; background: var(--fnaf-surface); }
    article:hover, article:focus-within { border-color: var(--fnaf-purple); }
    .producto-img { position: relative; display: grid; place-items: center; min-height: 8.5rem; background: var(--fnaf-surface2); }
    :host(.compacta) .producto-img { min-height: 6.25rem; }
    .img-pizza { background: linear-gradient(140deg, #221233, #381846); }
    .img-bebida { background: linear-gradient(140deg, #132238, #103845); }
    .img-souvenir { background: linear-gradient(140deg, #251e14, #41351d); }
    .img-animatronico { background: linear-gradient(140deg, #2b1625, #3f222e); }
    .icono { font-size: 3.5rem; line-height: 1; }
    :host(.compacta) .icono { font-size: 2.7rem; }
    .categoria { position: absolute; inset: .55rem .55rem auto auto; padding: .1rem .5rem; border-radius: .25rem; background: #0a0a0fbd; color: var(--fnaf-text); font-size: .875rem; }
    .info { display: flex; flex: 1; flex-direction: column; gap: .4rem; padding: .85rem; }
    h3 { margin: 0; font-size: 1.15rem; line-height: 1.15; letter-spacing: 0; }
    .titulo { display: inline-block; color: var(--fnaf-text); font: inherit; text-align: left; cursor: pointer; }
    .titulo:hover { color: var(--fnaf-cyan); }
    p { color: #b5b5cb; line-height: 1.35; }
    .pie { display: flex; flex-wrap: wrap; gap: .55rem; justify-content: space-between; align-items: center; margin-top: auto; padding-top: .35rem; }
    strong { color: var(--fnaf-cyan); white-space: nowrap; }
    .anadir { min-height: 2.75rem; padding: .4rem .7rem; border: 1px solid var(--fnaf-cyan); border-radius: .25rem; color: var(--fnaf-cyan); cursor: pointer; }
    .anadir:hover { background: #00f5ff1a; }
    button:focus-visible { outline: 2px solid var(--fnaf-yellow); outline-offset: 2px; }
  `],
})
export class ProductoCardComponent {
  readonly producto = input.required<ProductoVisible>();
  readonly ver = output<void>();
  readonly agregar = output<void>();
  get categoria() { return categorias[this.producto().categoria] ?? { icono: '📦', nombre: this.producto().categoria }; }
}
