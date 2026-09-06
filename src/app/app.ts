import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MsalService } from '@azure/msal-angular';

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

  ngOnInit() {
    // CRÍTICO: procesa el callback de Microsoft en CUALQUIER ruta.
    // Sin esto, si el MsalGuard redirige a /catalogo antes de que MSAL
    // termine de procesar el token, la pantalla queda en negro.
    this.msalSvc.handleRedirectObservable().subscribe();
  }
}
