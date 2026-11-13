import { API_SCOPE, MSALInterceptorConfigFactory } from './auth.config';

describe('MSAL cart URL compatibility', () => {
  it('keeps the current API Gateway /api/carrito protected resource', () => {
    expect(MSALInterceptorConfigFactory().protectedResourceMap.get(
      'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api/carrito',
    )).toEqual([API_SCOPE]);
  });
  it('protects payment, reward and recommendation routes on the configured production host', () => {
    const map = MSALInterceptorConfigFactory().protectedResourceMap;
    for (const route of ['pagos', 'orden', 'fidelizacion', 'recomendaciones', 'productos']) {
      expect(map.get(`https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api/${route}`)).toEqual([API_SCOPE]);
    }
  });
  it('local relative API protects only current-origin API, never arbitrary hosts or local gateway direct', () => {
    const map = MSALInterceptorConfigFactory('/api').protectedResourceMap;
    expect(map.get(`${window.location.origin}/api/pagos`)).toEqual([API_SCOPE]);
    expect([...map.keys()].every(url => url.startsWith(`${window.location.origin}/api/`))).toBe(true);
    expect(map.has('http://localhost:18090/api/pagos')).toBe(false);
    expect(map.has('https://untrusted.example/api/pagos')).toBe(false);
  });
});
