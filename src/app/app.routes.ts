import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'catalogo',
    loadComponent: () =>
      import('./features/catalog/catalogo.component').then(m => m.CatalogoComponent)
  },
  {
    path: 'pedidos',
    loadComponent: () =>
      import('./features/orders/orders.component').then(m => m.OrdersComponent)
  },
  { path: '**', redirectTo: 'login' }
];
