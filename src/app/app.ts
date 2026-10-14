import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
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
  private carritoSvc = inject(CarritoService);

  ngOnInit() {
    // CRÍTICO: procesa el callback de Microsoft en CUALQUIER ruta.
    // Sin esto, si el MsalGuard redirige a /catalogo antes de que MSAL
    // termine de procesar el token, la pantalla queda en negro.
    this.msalSvc.handleRedirectObservable().subscribe({
      next: () => {
        // Con la sesión ya establecida, restaura el carrito persistido
        // en ms-carrito (idempotente; si no hay sesión no hace llamadas).
        this.carritoSvc.inicializar();
      },
      error: () => this.carritoSvc.inicializar(),
    });
  }
}
