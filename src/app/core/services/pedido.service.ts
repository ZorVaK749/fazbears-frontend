import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ItemPedido {
  productoId: number;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
}

export interface Pedido {
  id?: number;
  usuarioId: string;
  emailUsuario: string;
  fechaCreacion?: string;
  total?: number;
  estado?: 'PENDIENTE' | 'PREPARANDO' | 'COMPLETADO';
  items: ItemPedido[];
}

@Injectable({ providedIn: 'root' })
export class PedidoService {
  private base = 'http://localhost:8082/api/pedidos';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(this.base);
  }

  getByUsuario(usuarioId: string): Observable<Pedido[]> {
    return this.http.get<Pedido[]>(`${this.base}/usuario/${usuarioId}`);
  }

  crear(pedido: Pedido): Observable<Pedido> {
    return this.http.post<Pedido>(this.base, pedido);
  }

  actualizarEstado(id: number, estado: string): Observable<Pedido> {
    return this.http.put<Pedido>(`${this.base}/${id}/estado`, { estado });
  }
}
