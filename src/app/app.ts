import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { MsalBroadcastService, MsalService } from '@azure/msal-angular';
import { EventType, InteractionStatus } from '@azure/msal-browser';
import { filter } from 'rxjs';
import { CarritoService } from './core/services/carrito.service';
import { CarritoComponent } from './features/cart/carrito.component';
import { NavegacionRecuperacion } from './core/navegacion-recuperacion.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CarritoComponent],
  template: `
    @if (navegacion.destino(); as destino) {
      <aside class="aviso-navegacion" role="alert">
        No se pudo cargar esta página. <a [href]="destino">Recargar página</a>
      </aside>
    }
    <router-outlet /><app-carrito />
  `,
  styles: [`
    .aviso-navegacion { padding: .8rem 1rem; background: var(--fnaf-surface); border-bottom: 1px solid var(--fnaf-purple); }
    .aviso-navegacion a { color: var(--fnaf-cyan); text-decoration: underline; }
  `]
})
export class App implements OnInit {
  title = 'Pedidos360 — Freddy Fazbear\'s Pizza';
  private msalSvc = inject(MsalService);
  private broadcast = inject(MsalBroadcastService);
  private carrito = inject(CarritoService);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  protected navegacion = inject(NavegacionRecuperacion);

  ngOnInit() {
    this.router.events.pipe(
      filter(evento => evento instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.navegacion.destino.set(null));
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
