import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { API_BASE_URL } from '../api.config';
import { CarritoParaConfirmar, CarritoService } from './carrito.service';

export type InstrumentoPrueba = 'sim-approved' | 'sim-declined';
export interface Cotizacion {
  operacionId: string; tenantId: string; ownerId: string; importe: number;
  moneda: string; expiraEn: string;
}
export interface Pago {
  pagoId: string; operacionId: string; estado: 'APPROVED' | 'DECLINED' | 'BLOCKED';
  importe: number; moneda: string; simulacion: boolean; creadoEn: string;
}
export interface ConfirmacionPago {
  pedidoId: number; mensaje: string; estado: string; total: number; pagoId: string; simulacion: true;
}
interface Flujo {
  snapshot: CarritoParaConfirmar; instrumento: InstrumentoPrueba;
  claveCotizacion: string; clavePago: string; claveConfirmacion: string;
  cotizacion?: Cotizacion; pago?: Pago; resultado?: ConfirmacionPago;
}

/** In-memory only: no bearer tokens, payment data or pending writes in localStorage.
 * Uncertain writes can only be retried explicitly, with the original key AND body.
 */
@Injectable({ providedIn: 'root' })
export class PagoService {
  private http = inject(HttpClient);
  private base = inject(API_BASE_URL);
  private carrito = inject(CarritoService);
  private flujo?: Flujo;
  private ocupado = false;

  cotizacion(operacionId: string) {
    return this.http.get<Cotizacion>(`${this.base}/orden/cotizaciones/${encodeURIComponent(operacionId)}`);
  }

  pendiente(): boolean {
    return !!this.flujo && this.carrito.mismaSesion(this.flujo.snapshot) && !this.flujo.resultado;
  }

  async procesar(instrumento: InstrumentoPrueba, activo = () => true): Promise<ConfirmacionPago> {
    if (this.ocupado) throw new Error('Ya hay una operación en curso.');
    this.ocupado = true;
    try {
      if (this.flujo && (!this.carrito.mismaSesion(this.flujo.snapshot) || this.flujo.resultado)) this.flujo = undefined;
      if (!this.flujo) {
        const snapshot = await this.carrito.prepararCheckout();
        if (!activo() || !this.carrito.snapshotVigente(snapshot)) {
          throw new Error('La sesión o el carrito cambió. Revisa el carrito antes de confirmar.');
        }
        this.flujo = { snapshot, instrumento, claveCotizacion: crypto.randomUUID(),
          clavePago: crypto.randomUUID(), claveConfirmacion: crypto.randomUUID() };
      }
      const f = this.flujo;
      const vigente = () => {
        if (!activo() || !this.carrito.mismaSesion(f.snapshot)) {
          throw new Error('La sesión cambió. Consulta el historial de la cuenta original.');
        }
      };
      vigente();
      if (f.resultado) return f.resultado;
      if (!f.cotizacion) {
        f.cotizacion = await this.post<Cotizacion>('/orden/cotizaciones', {
          items: f.snapshot.items.map(i => ({ productoId: i.productoId, cantidad: i.cantidad })),
        }, f.claveCotizacion);
      }
      vigente();
      const q = f.cotizacion;
      if (!q.operacionId || q.ownerId !== f.snapshot.usuarioId || q.tenantId !== f.snapshot.tenantId
          || !Number.isFinite(q.importe) || q.importe < 0 || !q.moneda) {
        throw new Error('Cotización incompatible con el propietario verificado.');
      }
      if (!f.pago) {
        // A replay after an uncertain payment must use the same quote even after expiry.
        // The server decides whether the operation already exists or has expired.
        try {
          f.pago = await this.post<Pago>('/pagos', { operacionId: q.operacionId,
            metodo: 'SIMULADO', instrumentoPruebaId: f.instrumento }, f.clavePago);
        } catch (error) {
          if (error instanceof HttpErrorResponse && error.status === 429 && error.error?.estado === 'BLOCKED') {
            f.pago = error.error as Pago;
          } else { throw error; }
        }
      }
      vigente();
      const pago = f.pago;
      if (!pago.pagoId || pago.operacionId !== q.operacionId || pago.simulacion !== true
          || pago.importe !== q.importe || pago.moneda !== q.moneda) {
        throw new Error('Respuesta de pago incompatible; no se confirmó el pedido.');
      }
      if (pago.estado !== 'APPROVED') {
        throw new Error(pago.estado === 'BLOCKED'
          ? 'Pago simulado bloqueado (429). No se confirmó ningún pedido.'
          : 'Pago simulado rechazado. No se confirmó ningún pedido.');
      }
      const resultado = await this.post<ConfirmacionPago>('/orden/confirmar-pago', {
        operacionId: q.operacionId, pagoId: pago.pagoId,
      }, f.claveConfirmacion);
      vigente();
      if (!resultado.pedidoId || resultado.pagoId !== pago.pagoId || resultado.simulacion !== true
          || resultado.total !== q.importe) throw new Error('Confirmación incompatible. Revisa tu historial.');
      f.resultado = resultado;
      this.carrito.limpiarTrasCompra(f.snapshot);
      return resultado;
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        throw new Error(`No se pudo confirmar la operación (${error.status || 'Red'}). Reintentar conserva la cotización, el instrumento y las claves originales; no inicia otro pago.`);
      }
      throw error;
    } finally { this.ocupado = false; }
  }

  /** Only a definitive decline/block may start another attempt; never discard an uncertain write. */
  nuevoIntento(): void {
    if (!this.ocupado && this.flujo?.pago && this.flujo.pago.estado !== 'APPROVED') this.flujo = undefined;
  }

  private post<T>(ruta: string, body: unknown, clave: string): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${this.base}${ruta}`, body, {
      headers: { 'Idempotency-Key': clave },
    }).pipe(timeout(15000)));
  }
}
