import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CarritoService } from '../../core/services/carrito.service';
import { RecomendacionesService } from '../../core/services/recomendaciones.service';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { RecomendacionesComponent } from '../../shared/recomendaciones/recomendaciones.component';
import { CatalogoComponent } from './catalogo.component';

@Component({ selector: 'app-navbar', standalone: true, template: '' })
class NavbarStub {}

@Component({ selector: 'app-recomendaciones', standalone: true, template: '' })
class RecomendacionesStub {}

describe('Catálogo', () => {
  it('muestra el 503 del catálogo y permite volver a consultar Productos', () => {
    TestBed.configureTestingModule({
      imports: [CatalogoComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CarritoService, useValue: {} },
        { provide: RecomendacionesService, useValue: {} },
      ],
    }).overrideComponent(CatalogoComponent, {
      remove: { imports: [NavbarComponent, RecomendacionesComponent] },
      add: { imports: [NavbarStub, RecomendacionesStub] },
    });

    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CatalogoComponent);
    const productos = 'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/ev3/api/productos';
    fixture.detectChanges();
    http.expectOne(productos).flush(null, { status: 503, statusText: 'Service Unavailable' });

    const alert = fixture.nativeElement.querySelector('[role=alert]');
    expect(alert.textContent).toContain('HTTP 503');
    expect(alert.textContent).not.toContain('localhost');
    alert.querySelector('button').click();
    http.expectOne(productos).flush([{ id: 1, nombre: 'Margherita', categoria: 'PIZZA', precio: 12990 }]);
    expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Margherita');
    http.verify();
  });
});
