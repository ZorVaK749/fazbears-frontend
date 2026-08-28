import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  importProvidersFrom,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  provideHttpClient,
  withInterceptorsFromDi,
  HTTP_INTERCEPTORS,
} from '@angular/common/http';
import {
  MsalModule,
  MsalService,
  MsalGuard,
  MsalBroadcastService,
  MsalInterceptor,
} from '@azure/msal-angular';
import {
  MSALInstanceFactory,
  MSALInterceptorConfigFactory,
  MSALGuardConfigFactory,
} from './core/auth/auth.config';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),

    // HttpClient con soporte para interceptores DI (necesario para MsalInterceptor)
    provideHttpClient(withInterceptorsFromDi()),

    // ─── MSAL providers ───────────────────────────────────────────────────────
    importProvidersFrom(
      MsalModule.forRoot(
        MSALInstanceFactory(),
        MSALGuardConfigFactory(),
        MSALInterceptorConfigFactory()
      )
    ),

    // Interceptor que adjunta el Bearer JWT automáticamente a las peticiones HTTP
    {
      provide: HTTP_INTERCEPTORS,
      useClass: MsalInterceptor,
      multi: true,
    },

    // Servicios MSAL
    MsalService,
    MsalGuard,
    MsalBroadcastService,
  ],
};
