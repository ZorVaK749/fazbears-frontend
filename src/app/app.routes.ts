import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

export const routes: Routes = [
  // Raíz → catálogo
  { path: '', redirectTo: 'catalogo', pathMatch: 'full' },

  // Login — no requiere autenticación
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(m => m.LoginComponent),
  },

  // Catálogo — protegido
  {
    path: 'catalogo',
    loadComponent: () =>
      import('./features/catalog/catalogo.component').then(m => m.CatalogoComponent),
    canActivate: [MsalGuard],
  },

  // Pedidos — protegido (clientes ven los suyos, admin ve todos)
  {
    path: 'pedidos',
    loadComponent: () =>
      import('./features/orders/orders.component').then(m => m.OrdersComponent),
    canActivate: [MsalGuard],
  },

  // Perfil de usuario — protegido
  {
    path: 'perfil',
    loadComponent: () =>
      import('./features/perfil/perfil.component').then(m => m.PerfilComponent),
    canActivate: [MsalGuard],
  },

  // Reportes — protegido (el componente redirige a /catalogo si no es admin)
  {
    path: 'reportes',
    loadComponent: () =>
      import('./features/reportes/reportes.component').then(m => m.ReportesComponent),
    canActivate: [MsalGuard],
  },

  // Wildcard → login
  { path: '**', redirectTo: 'login' },
];
