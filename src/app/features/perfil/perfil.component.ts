import { Component, OnInit, inject } from '@angular/core';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { RouterLink } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { AccountInfo } from '@azure/msal-browser';
import { PedidoService, Pedido } from '../../core/services/pedido.service';

const ADMIN_EMAILS = ['vic.placencia@duocuc.cl', 'Vic.placencia@duocuc.cl'];

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [NavbarComponent, RouterLink],
  template: `
    <app-navbar />

    <main class="perfil-main">
      <header class="perfil-header">
        <a routerLink="/catalogo" class="btn-neon btn-neon-cyan btn-volver">← VOLVER AL MENÚ</a>
      </header>

      @if (usuario) {
        <div class="perfil-hero">
          <div class="avatar-circle pixel">{{ inicial }}</div>
          <div class="perfil-info">
            <h1 class="pixel text-neon-yellow perfil-nombre">{{ usuario.name ?? usuario.username }}</h1>
            <p class="perfil-email">{{ usuario.username }}</p>
            @if (esAdmin) {
              <span class="badge-admin pixel">⚙ ADMINISTRADOR</span>
            } @else {
              <span class="badge-cliente pixel">👤 CLIENTE</span>
            }
          </div>
        </div>

        <!-- Stats -->
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-icon">📦</span>
            <div class="stat-val pixel text-neon-cyan">{{ misPedidos.length }}</div>
            <div class="stat-label">Pedidos realizados</div>
          </div>
          <div class="stat-card">
            <span class="stat-icon">💰</span>
            <div class="stat-val pixel text-neon-green">\${{ totalGastado.toFixed(2) }}</div>
            <div class="stat-label">Total gastado</div>
          </div>
          <div class="stat-card">
            <span class="stat-icon">⏳</span>
            <div class="stat-val pixel text-neon-yellow">{{ pendientes }}</div>
            <div class="stat-label">Pedidos pendientes</div>
          </div>
          <div class="stat-card">
            <span class="stat-icon">✅</span>
            <div class="stat-val pixel text-neon-purple">{{ completados }}</div>
            <div class="stat-label">Pedidos completados</div>
          </div>
        </div>

        <!-- Detalles de cuenta -->
        <div class="cuenta-panel">
          <h2 class="pixel panel-title text-neon-purple">🔐 DETALLES DE CUENTA</h2>
          <div class="cuenta-grid">
            <div class="cuenta-item">
              <span class="cuenta-key pixel">Nombre</span>
              <span class="cuenta-val">{{ usuario.name ?? '—' }}</span>
            </div>
            <div class="cuenta-item">
              <span class="cuenta-key pixel">Email</span>
              <span class="cuenta-val">{{ usuario.username }}</span>
            </div>
            <div class="cuenta-item">
              <span class="cuenta-key pixel">ID de cuenta</span>
              <span class="cuenta-val mono">{{ usuario.localAccountId }}</span>
            </div>
            <div class="cuenta-item">
              <span class="cuenta-key pixel">Rol</span>
              <span class="cuenta-val" [class.text-neon-yellow]="esAdmin">
                {{ esAdmin ? 'Administrador' : 'Cliente' }}
              </span>
            </div>
            <div class="cuenta-item">
              <span class="cuenta-key pixel">Proveedor</span>
              <span class="cuenta-val">Microsoft Azure AD</span>
            </div>
          </div>
        </div>

        <!-- Acciones rápidas -->
        <div class="acciones-panel">
          <h2 class="pixel panel-title text-neon-cyan">⚡ ACCIONES RÁPIDAS</h2>
          <div class="acciones-grid">
            <a routerLink="/pedidos" class="accion-card">
              <span class="accion-icon">📋</span>
              <span class="accion-label pixel">{{ esAdmin ? 'GESTIONAR PEDIDOS' : 'MIS PEDIDOS' }}</span>
            </a>
            <a routerLink="/catalogo" class="accion-card">
              <span class="accion-icon">🍕</span>
              <span class="accion-label pixel">VER MENÚ</span>
            </a>
            @if (esAdmin) {
              <a routerLink="/reportes" class="accion-card accion-admin">
                <span class="accion-icon">📊</span>
                <span class="accion-label pixel">REPORTES</span>
              </a>
            }
            <button class="accion-card accion-logout" (click)="logout()">
              <span class="accion-icon">🚪</span>
              <span class="accion-label pixel">CERRAR SESIÓN</span>
            </button>
          </div>
        </div>
      }
    </main>
  `,
  styles: [`
    .perfil-main { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; }
    .perfil-header { margin-bottom: 1.5rem; }
    .btn-volver { font-size: 0.85rem; padding: 0.4rem 1.2rem; display: inline-block; }

    /* Hero */
    .perfil-hero {
      display: flex; align-items: center; gap: 2rem;
      background: var(--fnaf-surface); border: 1px solid var(--fnaf-border);
      padding: 2rem; margin-bottom: 1.5rem;
    }
    .avatar-circle {
      width: 80px; height: 80px; border-radius: 50%;
      background: linear-gradient(135deg, var(--fnaf-purple), var(--fnaf-cyan));
      display: flex; align-items: center; justify-content: center;
      font-size: 2rem; color: white; flex-shrink: 0;
      box-shadow: 0 0 20px rgba(181,79,255,0.4);
    }
    .perfil-nombre { font-size: clamp(1.2rem, 3vw, 1.8rem); margin: 0 0 0.3rem; }
    .perfil-email { color: var(--fnaf-muted); font-size: 0.9rem; margin: 0 0 0.5rem; }
    .badge-admin {
      display: inline-block; background: rgba(255,215,0,0.1);
      border: 1px solid var(--fnaf-yellow); color: var(--fnaf-yellow);
      font-size: 0.72rem; padding: 0.2rem 0.8rem;
    }
    .badge-cliente {
      display: inline-block; background: rgba(0,245,255,0.08);
      border: 1px solid var(--fnaf-cyan); color: var(--fnaf-cyan);
      font-size: 0.72rem; padding: 0.2rem 0.8rem;
    }

    /* Stats */
    .stats-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem; margin-bottom: 1.5rem;
    }
    .stat-card {
      background: var(--fnaf-surface); border: 1px solid var(--fnaf-border);
      padding: 1.2rem 1rem; text-align: center;
      transition: border-color 0.2s;
    }
    .stat-card:hover { border-color: var(--fnaf-purple); }
    .stat-icon { font-size: 1.5rem; display: block; margin-bottom: 0.4rem; }
    .stat-val { font-size: 1.8rem; }
    .stat-label { color: var(--fnaf-muted); font-size: 0.75rem; margin-top: 0.3rem; }

    /* Cuenta */
    .cuenta-panel, .acciones-panel {
      background: var(--fnaf-surface); border: 1px solid var(--fnaf-border);
      padding: 1.5rem; margin-bottom: 1.5rem;
    }
    .panel-title { font-size: 1rem; margin: 0 0 1.2rem; }
    .cuenta-grid { display: flex; flex-direction: column; gap: 0; }
    .cuenta-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.7rem 0; border-bottom: 1px solid rgba(255,255,255,0.05);
      gap: 1rem;
    }
    .cuenta-item:last-child { border-bottom: none; }
    .cuenta-key { font-size: 0.75rem; color: var(--fnaf-muted); min-width: 130px; }
    .cuenta-val { font-size: 0.88rem; color: var(--fnaf-text); text-align: right; word-break: break-all; }
    .mono { font-family: monospace; font-size: 0.8rem; color: var(--fnaf-muted); }

    /* Acciones */
    .acciones-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
    .accion-card {
      display: flex; flex-direction: column; align-items: center; gap: 0.6rem;
      background: var(--fnaf-surface2); border: 1px solid var(--fnaf-border);
      padding: 1.2rem 0.5rem; cursor: pointer; text-decoration: none;
      transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
    }
    .accion-card:hover { border-color: var(--fnaf-cyan); background: rgba(0,245,255,0.05); box-shadow: 0 0 10px rgba(0,245,255,0.1); }
    .accion-admin:hover { border-color: var(--fnaf-yellow); background: rgba(255,215,0,0.05); box-shadow: 0 0 10px rgba(255,215,0,0.1); }
    .accion-logout { border: 1px solid var(--fnaf-border); background: transparent; width: 100%; font-family: inherit; }
    .accion-logout:hover { border-color: var(--fnaf-red); background: rgba(255,77,77,0.05); box-shadow: 0 0 10px rgba(255,77,77,0.1); }
    .accion-icon { font-size: 1.8rem; }
    .accion-label { font-size: 0.72rem; color: var(--fnaf-muted); text-align: center; }
  `]
})
export class PerfilComponent implements OnInit {
  private msalSvc   = inject(MsalService);
  private pedidoSvc = inject(PedidoService);

  usuario: AccountInfo | null = null;
  esAdmin = false;
  misPedidos: Pedido[] = [];

  get inicial(): string {
    return (this.usuario?.name ?? this.usuario?.username ?? '?')[0].toUpperCase();
  }
  get totalGastado(): number {
    return this.misPedidos.reduce((s, p) => s + (p.total ?? 0), 0);
  }
  get pendientes(): number {
    return this.misPedidos.filter(p => p.estado === 'PENDIENTE').length;
  }
  get completados(): number {
    return this.misPedidos.filter(p => p.estado === 'COMPLETADO').length;
  }

  ngOnInit() {
    const cuenta = this.msalSvc.instance.getAllAccounts()[0];
    this.usuario = cuenta ?? null;
    this.esAdmin = ADMIN_EMAILS.includes(cuenta?.username ?? '');

    if (cuenta) {
      this.pedidoSvc.getByUsuario(cuenta.localAccountId).subscribe({
        next: (p) => { this.misPedidos = p; }
      });
    }
  }

  logout() {
    this.msalSvc.logoutRedirect({
      postLogoutRedirectUri: window.location.origin + '/login',
    });
  }
}
