import { DOCUMENT, Injector } from '@angular/core';
import { NavigationError } from '@angular/router';
import { vi } from 'vitest';
import { NavegacionRecuperacion } from './navegacion-recuperacion.service';

describe('Recuperación de navegación tras publicar el frontend', () => {
  const origen = 'https://pedidos.example';
  const falloDeModulo = new TypeError('error loading dynamically imported module');

  function preparar() {
    const replace = vi.fn();
    const sessionStorage = { getItem: vi.fn(() => null as string | null), setItem: vi.fn() };
    const inyector = Injector.create({ providers: [NavegacionRecuperacion,
      { provide: DOCUMENT, useValue: { defaultView: { location: { origin: origen, replace }, sessionStorage } } },
    ] });
    return { recuperacion: inyector.get(NavegacionRecuperacion), replace, sessionStorage };
  }

  it('abre la ruta solicitada y conserva el fragmento de Configuración', () => {
    const { recuperacion, replace, sessionStorage } = preparar();
    recuperacion.recuperar(new NavigationError(1, '/perfil#configuracion', falloDeModulo));
    expect(replace).toHaveBeenCalledWith(`${origen}/perfil#configuracion`);
    expect(sessionStorage.setItem).toHaveBeenCalledOnce();
  });

  it('ofrece recarga manual si ya intentó la automática', () => {
    const { recuperacion, replace, sessionStorage } = preparar();
    sessionStorage.getItem.mockReturnValue(String(Date.now()));
    recuperacion.recuperar(new NavigationError(1, '/actividad', falloDeModulo));
    expect(replace).not.toHaveBeenCalled();
    expect(recuperacion.destino()).toBe('/actividad');
  });

  it('ignora otros errores y destinos externos', () => {
    const { recuperacion, replace } = preparar();
    recuperacion.recuperar(new NavigationError(1, '/actividad', new Error('Error del componente')));
    recuperacion.recuperar(new NavigationError(2, '//otro.example/actividad', falloDeModulo));
    expect(replace).not.toHaveBeenCalled();
    expect(recuperacion.destino()).toBeNull();
  });
});
