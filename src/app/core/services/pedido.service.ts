import { Injectable, inject } from '@angular/core';
import { API_BASE_URL } from '../api.config';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ItemPedido {
  productoId: number;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
}

export type EstadoPedido = 'PENDIENTE' | 'PREPARANDO' | 'COMPLETADO' | 'CANCELADO';

export interface Pedido {
  id?: number;
  usuarioId: string;
  emailUsuario: string;
  fechaCreacion?: string;
  total?: number;
  estado?: EstadoPedido;
  items: ItemPedido[];
}

@Injectable({ providedIn: 'root' })
export class PedidoService {
  private base = `${inject(API_BASE_URL)}/pedidos`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(this.base);
  }

  getByUsuario(usuarioId: string): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(`${this.base}/usuario/${encodeURIComponent(usuarioId)}`);
  }

  crear(pedido: Pedido): Observable<Pedido> {
    return this.http.post<Pedido>(this.base, pedido);
  }

  actualizarEstado(id: number, estado: EstadoPedido): Observable<Pedido> {
    return this.http.put<Pedido>(`${this.base}/${id}/estado`, { estado });
  }

  cancelar(id: number): Observable<Pedido> {
    return this.http.put<Pedido>(`${this.base}/${id}/estado`, { estado: 'CANCELADO' });
  }

  eliminar(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
