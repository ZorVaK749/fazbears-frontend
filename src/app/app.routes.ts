import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

export const routes: Routes = [
  // Raíz → redirige a login si no autenticado, o a catálogo si ya lo está
  { path: '', redirectTo: 'catalogo', pathMatch: 'full' },

  // Página de login — no requiere autenticación
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(m => m.LoginComponent),
  },

  // Catálogo — protegido: redirige a Microsoft login si no hay sesión
  {
    path: 'catalogo',
    loadComponent: () =>
      import('./features/catalog/catalogo.component').then(m => m.CatalogoComponent),
    canActivate: [MsalGuard],
  },

  // Pedidos — protegido
  {
    path: 'pedidos',
    loadComponent: () =>
      import('./features/orders/orders.component').then(m => m.OrdersComponent),
    canActivate: [MsalGuard],
  },

  // Wildcard → login
  { path: '**', redirectTo: 'login' },
];
