import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ItemCarrito } from './carrito.service';

export interface ConfirmarOrdenRequest {
  usuarioId: string;
  emailUsuario: string;
  items: ItemCarrito[];
}

export interface OrdenResponse {
  id: number;
  usuarioId: string;
  emailUsuario: string;
  estado: string;
  total: number;
  fechaCreacion: string;
}

@Injectable({ providedIn: 'root' })
export class OrdenService {
  private base = 'https://1nqf3okm71.execute-api.us-east-1.amazonaws.com/orden';

  constructor(private http: HttpClient) {}

  confirmar(orden: ConfirmarOrdenRequest): Observable<OrdenResponse> {
    return this.http.post<OrdenResponse>(`${this.base}/confirmar`, orden);
  }
}
