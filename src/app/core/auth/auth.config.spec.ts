import { API_SCOPE, MSALInterceptorConfigFactory } from './auth.config';

describe('MSAL cart URL compatibility', () => {
  it('keeps the current API Gateway /api/carrito protected resource', () => {
    expect(MSALInterceptorConfigFactory().protectedResourceMap.get(
      'https://uuzifgcyd2.execute-api.us-east-1.amazonaws.com/api/carrito',
    )).toEqual([API_SCOPE]);
  });
});
