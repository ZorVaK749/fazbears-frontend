import { InjectionToken } from '@angular/core';
import { environment } from '../../environments/environment';

/** Includes /api; override in DI for integration tests or alternate deployments. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root', factory: () => environment.apiBaseUrl,
});
