import { describe, it, expect } from 'vitest';
import { mapProviderReceiptStatus } from '../ports';

describe('C02 — mapa de status de receipt compartilhado', () => {
  it('preserva o mapeamento do baseline', () => {
    expect(mapProviderReceiptStatus('sent')).toBe('sent');
    expect(mapProviderReceiptStatus('delivered')).toBe('delivered');
    expect(mapProviderReceiptStatus('read')).toBe('delivered');
    expect(mapProviderReceiptStatus('played')).toBe('delivered');
    expect(mapProviderReceiptStatus('failed')).toBe('failed');
  });
});
