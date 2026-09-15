import { describe, expect, it } from 'vitest';
import { outboundDeliveryRepository } from '../infrastructure/repositories/outbound-delivery.repository';

/**
 * AAA-12 / C04 — decisão de remoção do caminho legado.
 *
 * `findByKey`, `createMapping` (ON CONFLICT (idempotency_key)) e `recordAttempt`
 * não têm mais chamadores desde que a persistência escopada passou a ser
 * responsabilidade de `persistOutboundIntentAtomically`. Mantê-los seria um
 * caminho morto que lançaria 42P10 se o índice global deixasse de ser único.
 * A compatibilidade de banco com writers antigos é garantida pelo índice
 * único global preservado na migration 0021 e verificada contra o schema
 * migrado em `aaa-12.integration.test.ts`.
 */
describe('outbound delivery repository — superfície pós-AAA-12', () => {
  it('não expõe o caminho legado removido (sem chamadores)', () => {
    const removed = ['findByKey', 'createMapping', 'recordAttempt', 'findByScope', 'findByMessageId'];
    for (const name of removed) {
      expect(name in outboundDeliveryRepository).toBe(false);
    }
  });

  it('expõe apenas o fechamento transacional da tentativa', () => {
    expect(typeof outboundDeliveryRepository.finalizeDelivery).toBe('function');
  });
});
