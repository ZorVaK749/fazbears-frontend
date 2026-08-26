import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Producto {
  id: number;
  nombre: string;
  descripcion: string;
  precio: number;
  categoria: 'PIZZA' | 'BEBIDA' | 'SOUVENIR' | 'ANIMATRONICO';
  imagenUrl: string;
}

@Injectable({ providedIn: 'root' })
export class ProductoService {
  private base = 'http://localhost:8081/api/productos';

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
