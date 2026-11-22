import { Component, ElementRef, OnInit, inject, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo } from '@azure/msal-browser';
import { CarritoService } from '../../core/services/carrito.service';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  host: { '(document:click)': 'cerrarCuentaAlPulsarFuera($event)' },
  template: `
    <nav class="navbar" aria-label="Navegación principal">
      <a routerLink="/catalogo" class="marca">
        <span class="pixel text-neon-yellow">🍕 Freddy</span>
        <span>Fazbear's Pizza</span>
      </a>

      <div class="enlaces">
        <a routerLink="/catalogo" routerLinkActive="activo" ariaCurrentWhenActive="page">Menú</a>
        <a routerLink="/pedidos" routerLinkActive="activo" ariaCurrentWhenActive="page">Mis pedidos</a>
        <a routerLink="/actividad" routerLinkActive="activo" ariaCurrentWhenActive="page">Mi actividad</a>
      </div>

      <div class="controles">
        <button id="btn-carrito" type="button" class="carrito" (click)="carritoSvc.toggleCarrito()"
                [attr.aria-expanded]="carritoSvc.abierto()"
                [attr.aria-label]="'Carrito (' + carritoSvc.cantidadItems + ')'">
          <span aria-hidden="true" class="icono-carrito">🛒</span>
          <span aria-hidden="true" class="etiqueta-carrito">Carrito</span>
          @if (carritoSvc.cantidadItems > 0) {
            <span aria-hidden="true" class="carrito-badge">{{ carritoSvc.cantidadItems }}</span>
          }
        </button>
        @if (usuario) {
          <details #cuenta class="cuenta" (keydown.escape)="cuenta.open = false; iconoCuenta.focus()">
            <summary #iconoCuenta aria-label="Menú de cuenta" class="cuenta-boton"><span class="icono-cuenta" aria-hidden="true"></span></summary>
            <div class="cuenta-opciones">
              <a routerLink="/perfil" (click)="cuenta.open = false">Mi perfil</a>
              <a routerLink="/perfil" fragment="configuracion" (click)="cuenta.open = false">Configuración de cuenta</a>
              <button id="btn-logout" type="button" (click)="cuenta.open = false; logout()">Salir</button>
            </div>
          </details>
        }
      </div>
    </nav>
  `,
  styles: [`
    .navbar {
      position: sticky; top: 0; z-index: 100;
      display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center;
      gap: .5rem 1rem; padding: .6rem clamp(.75rem, 3vw, 2rem);
      background: #0a0a0ff5; border-bottom: 1px solid var(--fnaf-border);
      box-shadow: 0 2px 16px #b54fff24;
    }
    .marca { display: flex; align-items: flex-start; flex-direction: column; justify-self: start; line-height: 1.15; text-decoration: none; }
    .marca > :first-child { font-size: 1.3rem; }
    .marca > :last-child { color: #b5b5cb; font-size: .85rem; }
    .enlaces { display: flex; justify-content: center; flex-wrap: wrap; gap: .2rem .65rem; }
    .enlaces a { display: flex; align-items: center; min-height: 2.75rem; padding: .35rem .55rem; color: var(--fnaf-text); border-bottom: 2px solid transparent; text-decoration: none; font-weight: 600; white-space: nowrap; }
    .enlaces a:hover, .enlaces .activo { color: var(--fnaf-cyan); border-color: var(--fnaf-cyan); }
    .controles { display: flex; align-items: center; justify-self: end; gap: .65rem; }
    .carrito, .cuenta-boton {
      position: relative; display: inline-flex; align-items: center; justify-content: center;
      min-width: 2.75rem; min-height: 2.75rem; gap: .45rem; padding: .35rem .65rem;
      border: 1px solid var(--fnaf-border); border-radius: .4rem; color: var(--fnaf-cyan); background: var(--fnaf-surface2); cursor: pointer;
    }
    .carrito:hover, .cuenta-boton:hover { border-color: var(--fnaf-cyan); }
    .carrito-badge {
      position: absolute; inset: -.3rem -.25rem auto auto; min-width: 1.25rem; padding-inline: .2rem;
      background: var(--fnaf-purple); color: var(--fnaf-bg); border-radius: 2rem;
      font-size: .8rem; font-weight: 700; text-align: center;
    }
    .cuenta { position: relative; }
    .cuenta-boton { list-style: none; }
    .cuenta-boton::-webkit-details-marker { display: none; }
    .icono-cuenta { position: relative; width: 1.15rem; height: 1.15rem; color: var(--fnaf-text); }
    .icono-cuenta::before, .icono-cuenta::after { content: ''; position: absolute; left: 50%; translate: -50% 0; border: 1.5px solid currentColor; }
    .icono-cuenta::before { top: 0; width: .5rem; height: .5rem; border-radius: 50%; }
    .icono-cuenta::after { bottom: 0; width: 1rem; height: .55rem; border-radius: 1rem 1rem .18rem .18rem; }
    .cuenta-opciones {
      position: absolute; z-index: 1; inset: calc(100% + .45rem) 0 auto auto;
      min-width: 11.75rem; max-width: calc(100vw - 1.5rem); padding: .25rem;
      border: 1px solid var(--fnaf-border); border-radius: .4rem; background: var(--fnaf-surface2); box-shadow: 0 8px 24px #0008;
    }
    .cuenta-opciones a, .cuenta-opciones button { display: flex; align-items: center; min-height: 2.75rem; width: 100%; padding: .35rem .6rem; text-decoration: none; text-align: left; color: var(--fnaf-text); cursor: pointer; }
    .cuenta-opciones a:hover, .cuenta-opciones button:hover { background: var(--fnaf-surface); color: var(--fnaf-cyan); }
    a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--fnaf-yellow); outline-offset: 2px; }
    @media (max-width: 58rem) { .etiqueta-carrito { display: none; } }
    @media (max-width: 40rem) {
      .navbar { grid-template-columns: minmax(0, 1fr) auto; }
      .enlaces { grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; }
      .controles { grid-column: 2; grid-row: 1; }
    }
  `],
})
export class NavbarComponent implements OnInit {
  readonly carritoSvc = inject(CarritoService);
  private readonly msalSvc = inject(MsalService);
  private readonly menuCuenta = viewChild<ElementRef<HTMLDetailsElement>>('cuenta');

  get usuario(): AccountInfo | null { return this.carritoSvc.cuentaActual(); }

  ngOnInit() {
    void this.carritoSvc.inicializar();
  }

  protected cerrarCuentaAlPulsarFuera(evento: MouseEvent): void {
    const menu = this.menuCuenta()?.nativeElement;
    if (menu?.open && !evento.composedPath().includes(menu)) menu.open = false;
  }

  logout() {
    this.carritoSvc.cerrarSesion();
    this.msalSvc.logoutRedirect({ postLogoutRedirectUri: window.location.origin + '/login' });
  }
}
