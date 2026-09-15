import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

function Bomb(): ReactElement {
  throw new Error('falha controlada');
}

afterEach(cleanup);

describe('ErrorBoundary', () => {
  it('renders an alert with the real message and a named retry action', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('falha controlada');
    expect(screen.getByRole('button', { name: 'Recarregar página' })).toBeTruthy();
    consoleSpy.mockRestore();
  });
});
