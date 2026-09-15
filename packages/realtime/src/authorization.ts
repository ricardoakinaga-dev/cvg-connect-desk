import type { ParsedChannel } from './channels';
import type { DeliveryTarget } from './routing';

/** Principal derivado da sessão validada (C01); o cliente nunca o define. */
export interface RealtimePrincipal {
  id: string;
  roles: string[];
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Porta de autorização por destinatário (C02 D-C02-2/3/6/7).
 *
 * Cada `subscribe` e cada entrega em canal de conteúdo chamam esta porta para
 * o ator da sessão; a implementação de produção usa `authorizeConversationResource`
 * e `authorizeSectorScope` de `@cvg/auth` (permission + membership no banco).
 */
export interface RealtimeAuthorizationPort {
  authorizeSubscription(principal: RealtimePrincipal, channel: ParsedChannel): Promise<AuthorizationDecision>;
  authorizeDelivery(principal: RealtimePrincipal, target: DeliveryTarget): Promise<AuthorizationDecision>;
}

export function allowDecision(): AuthorizationDecision {
  return { allowed: true, reason: 'permitted' };
}

export function denyDecision(reason: string): AuthorizationDecision {
  return { allowed: false, reason };
}

/**
 * Porta permissiva para testes de infraestrutura (fanout/dedup) que não
 * julgam autorização. O teste de isolamento AAA-05 usa a porta real de banco.
 */
export function createAllowAllAuthorizationPort(): RealtimeAuthorizationPort {
  return {
    async authorizeSubscription() {
      return allowDecision();
    },
    async authorizeDelivery() {
      return allowDecision();
    },
  };
}
