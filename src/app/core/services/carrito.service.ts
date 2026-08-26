import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Producto } from './producto.service';

export interface ItemCarrito {
  productoId: number;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
}

export interface CarritoState {
  items: ItemCarrito[];
  total: number;
}

@Injectable({ providedIn: 'root' })
export class CarritoService {
  private base = 'http://localhost:8083/api/carrito';

  /** Estado del carrito en memoria (reactivo con signals) */
  carrito = signal<CarritoState>({ items: [], total: 0 });
  abierto = signal<boolean>(false);

  constructor(private http: HttpClient) {}

  toggleCarrito() { this.abierto.update(v => !v); }
  cerrarCarrito() { this.abierto.set(false); }

  agregarProducto(producto: Producto, cantidad = 1) {
    this.carrito.update(state => {
      const existente = state.items.find(i => i.productoId === producto.id);
      let nuevosItems: ItemCarrito[];
      if (existente) {
        nuevosItems = state.items.map(i =>
          i.productoId === producto.id ? { ...i, cantidad: i.cantidad + cantidad } : i
        );
      } else {
        nuevosItems = [...state.items, {
          productoId: producto.id,
          nombreProducto: producto.nombre,
          cantidad,
          precioUnitario: producto.precio
        }];
      }
      return { items: nuevosItems, total: this.calcTotal(nuevosItems) };
    });
    this.abierto.set(true);
  }

  quitarItem(productoId: number) {
    this.carrito.update(state => {
      const nuevosItems = state.items.filter(i => i.productoId !== productoId);
      return { items: nuevosItems, total: this.calcTotal(nuevosItems) };
    });
  }

  cambiarCantidad(productoId: number, cantidad: number) {
    if (cantidad <= 0) { this.quitarItem(productoId); return; }
    this.carrito.update(state => {
      const nuevosItems = state.items.map(i =>
        i.productoId === productoId ? { ...i, cantidad } : i
      );
      return { items: nuevosItems, total: this.calcTotal(nuevosItems) };
    });
  }

  vaciar() { this.carrito.set({ items: [], total: 0 }); }

  get cantidadItems() {
    return this.carrito().items.reduce((acc, i) => acc + i.cantidad, 0);
  }

  private calcTotal(items: ItemCarrito[]): number {
    return items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0);
  }
}
