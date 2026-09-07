import { MsalInterceptorConfiguration, MsalGuardConfiguration } from '@azure/msal-angular';
import {
  PublicClientApplication,
  InteractionType,
  BrowserCacheLocation,
  LogLevel,
  type Configuration,
} from '@azure/msal-browser';
import { environment } from '../../../environments/environment';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  REEMPLAZA estos valores con los de tu App Registration en Azure Entra ID
//     Application (client) ID  → clientId
//     Directory  (tenant)  ID  → tenantId
// ─────────────────────────────────────────────────────────────────────────────
export const AZURE_CLIENT_ID = '4ff2634d-561c-45aa-b1f8-27f41e8f6237';
export const AZURE_TENANT_ID = 'e5372bf0-c5e3-4286-887c-79069f209c1f';

// Scope expuesto en "Expose an API" → api://<client-id>/access_as_user
export const API_SCOPE = `api://${AZURE_CLIENT_ID}/access_as_user`;

// ─── MSAL Browser Configuration ──────────────────────────────────────────────
export const msalConfig: Configuration = {
  auth: {
    clientId: AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
    redirectUri: 'http://localhost:4200',
    postLogoutRedirectUri: 'http://localhost:4200',
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: BrowserCacheLocation.LocalStorage,
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error('[MSAL]', message);
        if (level === LogLevel.Warning) console.warn('[MSAL]', message);
      },
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
  },
};

// ─── Scopes para login (openid/profile/email = info del usuario) ──────────────
export const loginRequest = {
  scopes: ['openid', 'profile', 'email'],
};

// ─── Scopes para acceder a la API (se adjunta al Bearer token) ───────────────
export const apiRequest = {
  scopes: [API_SCOPE],
};

// ─── MSAL Instance ────────────────────────────────────────────────────────────
export function MSALInstanceFactory(): PublicClientApplication {
  return new PublicClientApplication(msalConfig);
}

// ─── Interceptor config: adjunta token automáticamente a llamadas a la API ───
export function MSALInterceptorConfigFactory(): MsalInterceptorConfiguration {
  const protectedResourceMap = new Map<string, Array<string>>();

  // Rutas protegidas: el interceptor adjuntará el Bearer JWT en estas URLs
  protectedResourceMap.set(environment.apiProductos, [API_SCOPE]);
  protectedResourceMap.set(environment.apiCarrito, [API_SCOPE]);
  protectedResourceMap.set(environment.apiPedidos, [API_SCOPE]);

  // Cuando tengas las URLs de AWS API Gateway, agrégalas aquí también:
  // protectedResourceMap.set('https://<gateway>.execute-api.<region>.amazonaws.com/prod/*', [API_SCOPE]);

  return {
    interactionType: InteractionType.Redirect,
    protectedResourceMap,
  };
}

// ─── Guard config: redirige a login si no autenticado ────────────────────────
export function MSALGuardConfigFactory(): MsalGuardConfiguration {
  return {
    interactionType: InteractionType.Redirect,
    authRequest: loginRequest,
  };
}
