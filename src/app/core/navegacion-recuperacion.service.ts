import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { NavigationError } from '@angular/router';

const RECARGA = 'pedidos360.recarga-navegacion';
const ERROR_DE_MODULO = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .+ failed|unable to preload css/i;

@Injectable({ providedIn: 'root' })
export class NavegacionRecuperacion {
  private readonly documento = inject(DOCUMENT);
  readonly destino = signal<string | null>(null);

  recuperar(evento: NavigationError): void {
    const ventana = this.documento.defaultView;
    if (!ventana || !ERROR_DE_MODULO.test(String(evento.error?.message ?? evento.error))) return;

    const destino = new URL(evento.url, ventana.location.origin);
    if (destino.origin !== ventana.location.origin) return;

    this.destino.set(destino.pathname + destino.search + destino.hash);
    try {
      const ahora = Date.now();
      const recargaAnterior = Number(ventana.sessionStorage.getItem(RECARGA));
      if (ahora - recargaAnterior < 30_000) return;
      ventana.sessionStorage.setItem(RECARGA, String(ahora));
    } catch {
      return;
    }
    ventana.location.replace(destino.href);
  }
}
