import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { API_BASE_URL } from '../../core/api.config';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { DashboardComponent } from './dashboard.component';

@Component({ selector: 'app-navbar', template: '' })
class NavbarStub {}

class SocketStub {
  static instances: SocketStub[] = [];
  onopen?: () => void;
  onmessage?: (message: MessageEvent) => void;
  onclose?: () => void;
  readonly send = vi.fn();
  readonly close = vi.fn(() => this.onclose?.());

  constructor(readonly url: URL) { SocketStub.instances.push(this); }
}

describe('Dashboard WebSocket', () => {
  it('authenticates the socket by frame and reconnects with a fresh ticket', async () => {
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE_URL, useValue: '/api' }],
    }).overrideComponent(DashboardComponent, {
      remove: { imports: [NavbarComponent] }, add: { imports: [NavbarStub] },
    });
    vi.stubGlobal('WebSocket', SocketStub);
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(DashboardComponent);
    const http = TestBed.inject(HttpTestingController);
    const endpoint = '/api/analytics/me/dashboard-ticket';
    const url = 'wss://analytics.example.test/ws/analytics';
    try {
      fixture.detectChanges();
      http.expectOne(endpoint).flush({ url, ticket: 'a'.repeat(43) });
      await Promise.resolve();
      const first = SocketStub.instances[0];
      first.onopen?.();
      expect(first.url.toString()).toBe(url);
      expect(first.send).toHaveBeenCalledWith('a'.repeat(43));
      first.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
        interacciones: 1, productosMasVistos: [{ productoId: 1, nombre: 'Pizza', visitas: 1 }],
        categorias: [{ categoria: 'PIZZA', interacciones: 1 }],
      }) }));
      expect(fixture.componentInstance.metrics()?.interacciones).toBe(1);

      first.close();
      await vi.advanceTimersByTimeAsync(1000);
      http.expectOne(endpoint).flush({ url, ticket: 'b'.repeat(43) });
      await Promise.resolve();
      const second = SocketStub.instances[1];
      second.onopen?.();
      expect(second.send).toHaveBeenCalledWith('b'.repeat(43));
      http.verify();
    } finally {
      fixture.destroy();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      SocketStub.instances = [];
    }
  });
});
