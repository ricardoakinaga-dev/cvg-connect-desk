import type { GatewayOutboundPort } from '@cvg/messaging-contracts';

/**
 * Extensão local (sem alterar `@cvg/messaging-contracts`, fora do escopo de
 * AAA-12): expõe a capacidade declarada de idempotência do provider. `false`
 * obriga a intenção a nascer em `unknown_reconciling` (C04: provider sem
 * idempotência exige reconciliação explícita, nunca retry cego).
 */
export interface ChatGatewayOutboundPort extends GatewayOutboundPort {
  providerSupportsIdempotency?(): boolean;
}

/**
 * Registro do provedor outbound injetado pela composição (C02 §5, invariante 3).
 * Substitui o antigo import dinâmico do adapter de gateway dentro do chat.
 */
let gatewayOutboundPort: ChatGatewayOutboundPort | null = null;

export function setGatewayOutboundPort(port: ChatGatewayOutboundPort): void {
  gatewayOutboundPort = port;
}

export function getGatewayOutboundPort(): ChatGatewayOutboundPort {
  if (!gatewayOutboundPort) {
    throw new Error(
      'GatewayOutboundPort nao injetada: a composicao (apps/desk-api/src/app.ts) deve chamar setGatewayOutboundPort antes de enviar mensagens outbound.',
    );
  }
  return gatewayOutboundPort;
}

/** Uso restrito a testes/composição; limpa a injeção corrente. */
export function resetGatewayOutboundPort(): void {
  gatewayOutboundPort = null;
}
