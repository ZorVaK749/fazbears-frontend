import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../api.config';

export interface Recomendacion {
  productoId: number; nombre: string; categoria: string; precio: number; score: number; razon: string;
}
export interface Recomendaciones { estrategia: string; items: Recomendacion[]; generadoEn: string; }
@Injectable({ providedIn: 'root' })
export class RecomendacionesService {
  private http = inject(HttpClient);
  private base = inject(API_BASE_URL);
  obtener() { return this.http.get<Recomendaciones>(`${this.base}/recomendaciones/me?limit=6`); }
  interaccion(id: number, tipo: 'VIEW' | 'SELECT') {
    return this.http.post<void>(`${this.base}/productos/${id}/interacciones`, { tipo });
  }
}
