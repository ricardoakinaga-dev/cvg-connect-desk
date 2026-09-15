import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConnectionStatus, connectionPresentation, presencePresentation } from '../ConnectionStatus';
import type { RealtimeConnectionState, RealtimeConnectionStatus } from '../../../lib/realtime';

afterEach(cleanup);

function state(status: RealtimeConnectionStatus, reason?: string): RealtimeConnectionState {
  return { status, connected: status === 'connected', attempt: 0, reason, changedAt: Date.now() };
}

describe('connectionPresentation', () => {
  it.each([
    ['connected', 'Conectado', 'success'],
    ['connecting', 'Conectando', 'info'],
    ['reconnecting', 'Reconectando', 'warning'],
    ['offline', 'Offline', 'error'],
    ['idle', 'Sem conexão', 'neutral'],
  ] as const)('maps %s to label %s and tone %s', (status, label, tone) => {
    const presentation = connectionPresentation(state(status));
    expect(presentation.label).toBe(label);
    expect(presentation.tone).toBe(tone);
    expect(presentation.detail.length).toBeGreaterThan(0);
  });

  it('explains offline reasons truthfully', () => {
    expect(connectionPresentation(state('offline', 'unauthorized')).detail).toContain('rejeitada');
    expect(connectionPresentation(state('offline', 'missing-url')).detail).toContain('não configurado');
  });
});

describe('presencePresentation', () => {
  it.each([
    ['connected', 'is-connected', 'Central conectada'],
    ['connecting', 'is-connecting', 'Conectando à central'],
    ['reconnecting', 'is-degraded', 'Central instável'],
    ['offline', 'is-offline', 'Central offline'],
    ['idle', 'is-idle', 'Tempo real inativo'],
  ] as const)('maps %s to %s / %s', (status, modifier, title) => {
    expect(presencePresentation(state(status))).toMatchObject({ modifier, title });
  });
});

describe('ConnectionStatus', () => {
  it('renders status as text plus icon in a live region, never color-only', () => {
    render(<ConnectionStatus state={state('connected')} />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('Conectado');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.getAttribute('aria-live')).toBe('polite');
    expect(badge.getAttribute('aria-label')).toContain('Tempo real: Conectado');
    expect(badge.className).toContain('ui-badge--success');
  });

  it('renders the degraded state with warning tone and accessible detail', () => {
    render(<ConnectionStatus state={state('reconnecting')} className="topbar-status" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('Reconectando');
    expect(badge.getAttribute('aria-label')).toContain('Conexão instável');
    expect(badge.className).toContain('ui-badge--warning');
    expect(badge.className).toContain('topbar-status');
  });

  it('renders the idle state as neutral without claiming connectivity', () => {
    render(<ConnectionStatus state={state('idle')} />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('Sem conexão');
    expect(badge.textContent).not.toContain('Online');
    expect(badge.className).toContain('ui-badge--neutral');
  });
});
