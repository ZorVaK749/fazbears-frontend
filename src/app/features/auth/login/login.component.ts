import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MsalService, MsalBroadcastService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { loginRequest } from '../../../core/auth/auth.config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [],
  template: `
    <div class="login-container">
      <!-- Fondo con gradiente radial -->
      <div class="login-bg"></div>

      <!-- Panel central -->
      <div class="login-panel">
        <!-- Año / sistema -->
        <p class="pixel text-neon-green blink login-year">[ SISTEMA ACTIVO — 1987 ]</p>

        <!-- Logo principal con glitch -->
        <h1 class="pixel glitch-text login-title" data-text="FREDDY FAZBEAR'S">
          FREDDY FAZBEAR'S
        </h1>
        <h2 class="pixel login-subtitle text-neon-yellow">PIZZA</h2>

        <!-- Línea decorativa -->
        <div class="login-divider"></div>

        <p class="login-desc">Sistema interno de pedidos y reservaciones</p>
        <p class="login-desc">Acceso exclusivo para personal autorizado</p>

        <!-- Botón login con Microsoft -->
        <button
          id="btn-microsoft-login"
          class="btn-neon login-btn"
          (click)="loginConMicrosoft()"
          [disabled]="cargando">
          @if (cargando) {
            <span class="pixel blink">[ AUTENTICANDO... ]</span>
          } @else {
            ⊞ &nbsp; INICIAR SESIÓN CON MICROSOFT
          }
        </button>

        <!-- Advertencia FNaF -->
        <p class="login-warning pixel blink">
          ⚠ MANTÉN LAS PUERTAS CERRADAS DESPUÉS DE LAS 12 AM ⚠
        </p>
      </div>

      <!-- Decoración esquinas -->
      <div class="corner corner-tl"></div>
      <div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div>
      <div class="corner corner-br"></div>
    </div>
  `,
  styles: [`
    .login-container {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      position: relative; overflow: hidden;
    }

    .login-bg {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse at 30% 50%, rgba(181,79,255,0.08) 0%, transparent 60%),
        radial-gradient(ellipse at 70% 50%, rgba(0,245,255,0.05) 0%, transparent 60%),
        var(--fnaf-bg);
    }

    .login-panel {
      position: relative; z-index: 10;
      display: flex; flex-direction: column; align-items: center;
      gap: 1.2rem; padding: 3rem 4rem;
      background: rgba(19,19,26,0.85);
      border: 1px solid var(--fnaf-border);
      box-shadow:
        0 0 40px rgba(181,79,255,0.15),
        0 0 80px rgba(0,0,0,0.6),
        inset 0 0 40px rgba(181,79,255,0.03);
      backdrop-filter: blur(4px);
      max-width: 500px; width: 90%;
    }

    .login-year { font-size: 0.9rem; margin: 0; }

    .login-title {
      font-size: clamp(2.5rem, 8vw, 4rem);
      color: var(--fnaf-text);
      margin: 0;
      text-shadow: 0 0 20px rgba(255,255,255,0.1);
    }

    .login-subtitle {
      font-size: clamp(3rem, 10vw, 5.5rem);
      margin: -1rem 0 0;
      text-shadow: 0 0 30px var(--fnaf-yellow), 0 0 60px rgba(255,215,0,0.4);
    }

    .login-divider {
      width: 100%; height: 1px;
      background: linear-gradient(90deg, transparent, var(--fnaf-purple), var(--fnaf-cyan), transparent);
      box-shadow: 0 0 8px var(--fnaf-purple);
    }

    .login-desc { color: var(--fnaf-muted); margin: 0; font-size: 0.9rem; text-align: center; }

    .login-btn {
      font-size: 1.15rem; margin-top: 0.5rem;
      padding: 0.75rem 2.5rem; width: 100%;
    }
    .login-btn:disabled { opacity: 0.6; cursor: not-allowed; }

    .login-warning {
      font-size: 0.7rem; color: var(--fnaf-red);
      text-shadow: 0 0 6px var(--fnaf-red);
      margin: 0; text-align: center;
    }

    .corner {
      position: absolute; width: 30px; height: 30px;
      border-color: var(--fnaf-purple); border-style: solid;
    }
    .corner-tl { top: 1rem; left: 1rem; border-width: 2px 0 0 2px; }
    .corner-tr { top: 1rem; right: 1rem; border-width: 2px 2px 0 0; }
    .corner-bl { bottom: 1rem; left: 1rem; border-width: 0 0 2px 2px; }
    .corner-br { bottom: 1rem; right: 1rem; border-width: 0 2px 2px 0; }
  `]
})
export class LoginComponent implements OnInit, OnDestroy {
  private msalSvc = inject(MsalService);
  private msalBroadcast = inject(MsalBroadcastService);
  private router = inject(Router);

  cargando = false;
  private destroy$ = new Subject<void>();

  ngOnInit() {
    // Escucha el resultado del redirect de Microsoft
    this.msalSvc.handleRedirectObservable().subscribe();

    // Si ya hay sesión activa → navega directo al catálogo
    this.msalBroadcast.inProgress$
      .pipe(
        filter(status => status === InteractionStatus.None),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        if (this.msalSvc.instance.getAllAccounts().length > 0) {
          this.router.navigate(['/catalogo']);
        }
      });
  }

  loginConMicrosoft() {
    this.cargando = true;
    // Inicia el flujo Authorization Code + PKCE via redirect
    this.msalSvc.loginRedirect(loginRequest);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
