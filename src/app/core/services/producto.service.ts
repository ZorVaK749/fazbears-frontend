import { Injectable, inject } from '@angular/core';
import { API_BASE_URL } from '../api.config';
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
  private base = `${inject(API_BASE_URL)}/productos`;

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
