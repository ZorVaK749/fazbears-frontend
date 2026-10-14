import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, timeout } from 'rxjs';
import { ReportesService, ResumenReporte } from '../../core/services/reportes.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { RouterLink } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { Router } from '@angular/router';

const ADMIN_EMAILS = ['vic.placencia@duocuc.cl', 'Vic.placencia@duocuc.cl'];

@Component({
  selector: 'app-reportes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavbarComponent, RouterLink],
  template: `
    <app-navbar />

    <main class="reportes-main">
      <header class="reportes-header">
        <div class="header-top">
          <div>
            <h1 class="pixel text-neon-yellow">📊 PANEL DE REPORTES</h1>
            <p class="reportes-sub">Dashboard administrativo — Freddy Fazbear's Pizza</p>
          </div>
          <a routerLink="/pedidos" class="btn-neon btn-neon-cyan btn-volver">← GESTIÓN PEDIDOS</a>
        </div>
        <div class="admin-badge pixel">⚙ ACCESO RESTRINGIDO — SOLO ADMINISTRADORES</div>
      </header>

      @if (cargando()) {
        <div class="loading-grid">
          <p class="pixel text-neon-cyan blink">[ CARGANDO DATOS... ]</p>
        </div>
      }

      @if (!cargando() && resumen(); as reporte) {
        <!-- KPI Cards -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-icon">📦</span>
            <div class="kpi-valor pixel text-neon-cyan">{{ reporte.totalPedidos }}</div>
            <div class="kpi-label">PEDIDOS TOTALES</div>
          </div>
          <div class="kpi-card">
            <span class="kpi-icon">💰</span>
            <div class="kpi-valor pixel text-neon-green">\${{ reporte.ingresosTotales.toFixed(2) }}</div>
            <div class="kpi-label">INGRESOS TOTALES</div>
          </div>
          <div class="kpi-card">
            <span class="kpi-icon">⏳</span>
            <div class="kpi-valor pixel text-neon-yellow">\${{ reporte.promedioPerPedido.toFixed(2) }}</div>
            <div class="kpi-label">PROMEDIO POR PEDIDO</div>
          </div>
          <div class="kpi-card">
            <span class="kpi-icon">✅</span>
            <div class="kpi-valor pixel text-neon-purple">{{ reporte.ventas.length }}</div>
            <div class="kpi-label">VENTAS REGISTRADAS</div>
          </div>
        </div>

        <div class="panel panel-full">
            <h2 class="pixel panel-title text-neon-cyan">📋 VENTAS RECIBIDAS POR RABBITMQ</h2>
            @if (reporte.ventas.length) {
              <table class="mini-table">
                <thead>
                  <tr>
                    <th class="pixel">PEDIDO</th>
                    <th class="pixel">FECHA</th>
                    <th class="pixel">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  @for (venta of reporte.ventas; track $index) {
                    <tr>
                      <td class="pixel text-neon-yellow">#{{ venta.pedidoId }}</td>
                      <td>{{ formatDay(venta.fechaCreacion) }}</td>
                      <td class="pixel text-neon-green">\${{ venta.total.toFixed(2) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <p class="no-data pixel">[ SIN DATOS AÚN ]</p>
            }
        </div>
      }

      @if (!cargando() && !resumen()) {
        <div class="error-box" role="alert">
          <p class="pixel text-neon-red">[ ERROR AL CARGAR REPORTES ]</p>
          <p style="color:var(--fnaf-muted)">{{ errorMsg() }}</p>
          <button class="btn-neon" style="margin-top:1rem" (click)="cargar()">REINTENTAR</button>
        </div>
      }
    </main>
  `,
  styles: [`
    .reportes-main { max-width: 1300px; margin: 0 auto; padding: 2rem 1.5rem; }

    .reportes-header { margin-bottom: 2rem; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
    .reportes-header h1 { font-size: clamp(1.3rem, 4vw, 1.8rem); margin: 0 0 0.4rem; }
    .reportes-sub { color: var(--fnaf-muted); font-size: 0.85rem; margin: 0; }
    .btn-volver { font-size: 0.85rem; padding: 0.4rem 1.2rem; white-space: nowrap; display: inline-block; }
    .admin-badge {
      display: inline-block; margin-top: 0.75rem;
      background: rgba(255,77,77,0.1); border: 1px solid var(--fnaf-red);
      color: var(--fnaf-red); font-size: 0.72rem; padding: 0.3rem 1rem;
    }

    /* KPI */
    .kpi-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem; margin-bottom: 1.5rem;
    }
    .kpi-card {
      background: var(--fnaf-surface); border: 1px solid var(--fnaf-border);
      padding: 1.5rem 1rem; text-align: center;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .kpi-card:hover { border-color: var(--fnaf-purple); box-shadow: 0 0 15px rgba(181,79,255,0.1); }
    .kpi-icon { font-size: 2rem; display: block; margin-bottom: 0.5rem; }
    .kpi-valor { font-size: 2rem; }
    .kpi-label { color: var(--fnaf-muted); font-size: 0.75rem; margin-top: 0.4rem; letter-spacing: 1px; }

    /* Panels */
    .section-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
    @media (max-width: 700px) { .section-grid { grid-template-columns: 1fr; } }
    .panel {
      background: var(--fnaf-surface); border: 1px solid var(--fnaf-border); padding: 1.5rem;
    }
    .panel-full { margin-bottom: 2rem; }
    .panel-title { font-size: 1rem; margin: 0 0 1.2rem; }

    /* Barras de estado */
    .estado-bars { display: flex; flex-direction: column; gap: 0.8rem; }
    .bar-row { display: flex; align-items: center; gap: 0.75rem; }
    .bar-label { font-size: 0.72rem; min-width: 90px; }
    .bar-track { flex: 1; height: 8px; background: var(--fnaf-surface2); border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.8s ease; min-width: 4px; }
    .bar-fill.text-neon-yellow { background: var(--fnaf-yellow); }
    .bar-fill.text-neon-green  { background: var(--fnaf-green); }
    .bar-fill.text-neon-red    { background: var(--fnaf-red); }
    .bar-fill.text-orange      { background: #ff8c00; }
    .bar-count { font-size: 0.8rem; min-width: 24px; text-align: right; color: var(--fnaf-muted); }

    /* Mini table */
    .mini-table { width: 100%; border-collapse: collapse; }
    .mini-table th {
      color: var(--fnaf-purple); font-size: 0.75rem; padding: 0.5rem 0.5rem;
      text-align: left; border-bottom: 1px solid var(--fnaf-border);
    }
    .mini-table td { padding: 0.5rem 0.5rem; font-size: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .no-data { color: var(--fnaf-muted); font-size: 0.8rem; text-align: center; padding: 2rem 0; }

    /* Day chart */
    .day-chart { display: flex; align-items: flex-end; gap: 0.5rem; height: 160px; padding-top: 1rem; overflow-x: auto; }
    .day-col { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; min-width: 60px; flex: 1; }
    .day-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; }
    .day-bar {
      width: 100%; min-height: 4px;
      background: linear-gradient(to top, var(--fnaf-green), rgba(57,255,20,0.3));
      border-radius: 3px 3px 0 0;
      transition: height 0.6s ease;
    }
    .day-val { font-size: 0.65rem; }
    .day-label { font-size: 0.7rem; color: var(--fnaf-muted); }

    .loading-grid { text-align: center; padding: 4rem; }
    .error-box { text-align: center; padding: 4rem 1rem; }

    .text-neon-red { color: var(--fnaf-red); }
    .text-orange { color: #ff8c00; }
  `]
})
export class ReportesComponent implements OnInit {
  private reportesSvc = inject(ReportesService);
  private msalSvc     = inject(MsalService);
  private router      = inject(Router);
  private destroyRef  = inject(DestroyRef);

  resumen = signal<ResumenReporte | null>(null);
  cargando = signal(true);
  errorMsg = signal('');

  ngOnInit() {
    const cuenta = this.msalSvc.instance.getAllAccounts()[0];
    const esAdmin = ADMIN_EMAILS.includes(cuenta?.username ?? '');
    if (!esAdmin) { this.router.navigate(['/catalogo']); return; }
    this.cargar();
  }

  cargar() {
    this.cargando.set(true);
    this.resumen.set(null);
    this.errorMsg.set('');
    this.reportesSvc.getResumen().pipe(
      timeout(15000),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.cargando.set(false)),
    ).subscribe({
      next: (r) => this.resumen.set(r),
      error: (err) => {
        if (err.name === 'TimeoutError') {
          this.errorMsg.set('El servicio tardó demasiado en responder. Puedes reintentar.');
        } else if (err.status === 401 || err.status === 403) {
          this.errorMsg.set('No se pudo autorizar la consulta. Revisa tu sesión y permisos.');
        } else {
          this.errorMsg.set(`No se pudieron cargar los reportes (${err.status || 'Red'}). Puedes reintentar.`);
        }
      },
    });
  }

  estadoColor(estado: string): string {
    const map: Record<string, string> = {
      PENDIENTE: 'text-neon-yellow',
      PREPARANDO: 'text-orange',
      COMPLETADO: 'text-neon-green',
      CANCELADO: 'text-neon-red',
    };
    return map[estado] ?? 'text-neon-purple';
  }

  formatDay(fecha: string): string {
    return new Date(fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }
}
