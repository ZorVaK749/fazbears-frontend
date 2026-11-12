import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { EventType, InteractionStatus } from '@azure/msal-browser';
import { filter } from 'rxjs';
import { CarritoService } from './core/services/carrito.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  styles: []
})
export class App implements OnInit {
  title = 'Pedidos360 — Freddy Fazbear\'s Pizza';
  private msalSvc = inject(MsalService);
  private broadcast = inject(MsalBroadcastService);
  private carrito = inject(CarritoService);
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    // CRÍTICO: procesa el callback de Microsoft en CUALQUIER ruta.
    // Sin esto, si el MsalGuard redirige a /catalogo antes de que MSAL
    // termine de procesar el token, la pantalla queda en negro.
    this.msalSvc.handleRedirectObservable().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: resultado => {
        if (resultado?.account) this.msalSvc.instance.setActiveAccount(resultado.account);
        void this.carrito.inicializar();
      },
      error: () => this.carrito.cerrarSesion(),
    });
    this.broadcast.inProgress$.pipe(
      filter(estado => estado === InteractionStatus.None), takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => { void this.carrito.inicializar(); });
    this.broadcast.msalSubject$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(evento => {
      if (evento.eventType === EventType.LOGOUT_START) this.carrito.cerrarSesion();
      if (evento.eventType === EventType.ACTIVE_ACCOUNT_CHANGED || evento.eventType === EventType.ACCOUNT_REMOVED) {
        void this.carrito.inicializar();
      }
    });
  }
}
