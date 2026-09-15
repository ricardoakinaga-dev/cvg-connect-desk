import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, TextField } from '../index';

afterEach(cleanup);

describe('Button', () => {
  it('renders an accessible name and emits clicks', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Salvar</Button>);
    const button = screen.getByRole('button', { name: 'Salvar' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks loading state as busy, disabled and hides the spinner from assistive tech', () => {
    render(<Button loading>Salvando</Button>);
    const button = screen.getByRole('button', { name: 'Salvando' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.ui-spinner')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TextField', () => {
  it('associates label, hint and error with the input', () => {
    render(<TextField label="Email" hint="Use o e-mail corporativo" error="Credenciais inválidas" />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(describedBy).toHaveLength(2);
    expect(screen.getByText('Credenciais inválidas').getAttribute('role')).toBe('alert');
  });
});

describe('Badge', () => {
  it('exposes status text and an icon so meaning is not color-only', () => {
    render(<Badge tone="error" status>Falhou</Badge>);
    const badge = screen.getByText('Falhou');
    expect(badge.textContent).toContain('Falhou');
    expect(badge.querySelector('svg')).not.toBeNull();
  });
});

describe('state messages', () => {
  it('announces loading as a polite status', () => {
    render(<LoadingState label="Carregando tarefas" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Carregando tarefas');
  });

  it('renders empty state copy', () => {
    render(<EmptyState title="Nenhuma tarefa" description="Crie a primeira tarefa" />);
    expect(screen.getByText('Nenhuma tarefa')).toBeTruthy();
    expect(screen.getByText('Crie a primeira tarefa')).toBeTruthy();
  });

  it('announces errors and wires the retry action', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Falha de rede" onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Falha de rede');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('Card', () => {
  it('supports semantic elements and interactive affordance', () => {
    render(<Card as="section" interactive aria-label="Grupo" />);
    const card = screen.getByLabelText('Grupo');
    expect(card.tagName).toBe('SECTION');
    expect(card.className).toContain('ui-card--interactive');
  });
});
