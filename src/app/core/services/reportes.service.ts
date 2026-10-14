import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ResumenReporte {
  totalPedidos: number;
  ingresosTotales: number;
  promedioPerPedido: number;
  ventas: { pedidoId: number; usuarioId: string; total: number; fechaCreacion: string }[];
}

export interface IngresosReporte {
  ingresosTotales: number;
  totalPedidos: number;
}

@Injectable({ providedIn: 'root' })
export class ReportesService {
  private base = 'https://1nqf3okm71.execute-api.us-east-1.amazonaws.com/reportes';

  constructor(private http: HttpClient) {}

  getResumen(): Observable<ResumenReporte> {
    return this.http.get<ResumenReporte>(`${this.base}/resumen`);
  }

  getIngresos(): Observable<IngresosReporte> {
    return this.http.get<IngresosReporte>(`${this.base}/ingresos`);
  }
}
