import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ResumenReporte {
  totalPedidos: number;
  totalIngresos: number;
  pedidosPorEstado: Record<string, number>;
  productosMasVendidos: { nombre: string; cantidad: number }[];
}

export interface IngresosReporte {
  totalIngresos: number;
  ingresosPorDia: { fecha: string; total: number }[];
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
