import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Producto {
  id: number;
  nombre: string;
  descripcion: string;
  precio: number;
  categoria: 'PIZZA' | 'BEBIDA' | 'SOUVENIR' | 'ANIMATRONICO';
  imagenUrl?: string | null;  // Opcional: los productos sin imagen usan emoji/CSS
}

@Injectable({ providedIn: 'root' })
export class ProductoService {
  private base = 'https://1nqf3okm71.execute-api.us-east-1.amazonaws.com/productos';

  constructor(private http: HttpClient) {}

  getAll(): Observable<Producto[]> {
    return this.http.get<Producto[]>(this.base);
  }

  getByCategoria(categoria: string): Observable<Producto[]> {
    return this.http.get<Producto[]>(`${this.base}/categoria/${categoria}`);
  }

  getById(id: number): Observable<Producto> {
    return this.http.get<Producto>(`${this.base}/${id}`);
  }
}
