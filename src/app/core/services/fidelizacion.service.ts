import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../api.config';
import { CarritoService, IdentidadSesion } from './carrito.service';
import { firstValueFrom, timeout } from 'rxjs';

export interface Saldo { saldo: number; disponible: number; deuda: number; simulacion: true; }
export interface Recompensa { id: string; nombre: string; costo: number; }
export interface Movimiento {
  id?: string; tipo?: string; cantidad?: number; importe?: number;
  descripcion?: string; creadoEn?: string; [key: string]: unknown;
}
@Injectable({ providedIn: 'root' })
export class FidelizacionService {
  private http = inject(HttpClient);
  private base = `${inject(API_BASE_URL)}/fidelizacion`;
  private carrito = inject(CarritoService);
  private pendiente?: { identidad: Readonly<IdentidadSesion>; body: { recompensaId: string; cantidad: number }; clave: string };
  private ocupado = false;
  saldo() { return this.http.get<Saldo>(`${this.base}/me/saldo`); }
  movimientos() { return this.http.get<Movimiento[]>(`${this.base}/me/movimientos`); }
  recompensas() { return this.http.get<Recompensa[]>(`${this.base}/recompensas`); }
  canjear(body: { recompensaId: string; cantidad: number }, clave: string) {
    return this.http.post<unknown>(`${this.base}/me/canjes`, body, { headers: { 'Idempotency-Key': clave } });
  }
  async solicitarCanje(recompensaId: string): Promise<void> {
    if (this.ocupado) throw new Error('Canje en curso.');
    const identidad = this.carrito.identidadVerificada();
    if (!identidad || !this.carrito.esIdentidadActual(identidad)) throw new Error('Verifica tu sesión primero.');
    if (this.pendiente && !this.carrito.esIdentidadActual(this.pendiente.identidad)) this.pendiente = undefined;
    this.pendiente ??= { identidad, body: { recompensaId, cantidad: 1 }, clave: crypto.randomUUID() };
    const intento = this.pendiente;
    this.ocupado = true;
    try {
      await firstValueFrom(this.canjear(intento.body, intento.clave).pipe(timeout(15000)));
      this.pendiente = undefined;
      if (!this.carrito.esIdentidadActual(intento.identidad)) throw new Error('La sesión cambió; consulta la cuenta original.');
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 422 || status === 409) this.pendiente = undefined;
      throw new Error(status === 422 ? 'FazCoins insuficientes (422).'
        : status === 409 ? 'Conflicto de canje (409). Actualiza el saldo.'
        : 'Canje sin confirmar. Reintentar reutiliza la misma recompensa, cantidad y clave.');
    } finally { this.ocupado = false; }
  }
}
