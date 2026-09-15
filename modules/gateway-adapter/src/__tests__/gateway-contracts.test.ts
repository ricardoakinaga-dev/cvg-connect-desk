import { describe, it, expect } from 'vitest';
import {
  normalizeEvolutionMessage,
  normalizeGatewayInbound,
  toWAInboundEvent,
} from '../infrastructure/gateway-normalizer';
import { parseInboundMessageV1 } from '@cvg/messaging-contracts';

/**
 * Contract tests (Phase 2 §5.1): domínio nunca recebe payload cru da Evolution.
 * Toda saída do normalizer com destino ao chat deve satisfazer InboundMessageV1.
 */
describe('gateway → chat message contracts', () => {
  const evolutionTextPayload = {
    event: 'MESSAGES_UPSERT',
    instance: 'cvg-desk',
    data: {
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        id: 'wamid.contract123',
        fromMe: false,
      },
      pushName: 'Contrato Teste',
      message: { conversation: 'Olá, contrato!' },
      messageTimestamp: 1789176300,
    },
  };

  it('normalizeEvolutionMessage produz WA_INBOUND com IDs obrigatórios', () => {
    const waEvent = normalizeEvolutionMessage(evolutionTextPayload);

    expect(waEvent).not.toBeNull();
    expect(waEvent?.event_type).toBe('WA_INBOUND');
    expect(waEvent?.payload.messageId).toBe('wamid.contract123');
    expect(waEvent?.payload.remoteJid).toBe('5511999999999@s.whatsapp.net');
  });

  it('pipeline Evolution → WA_INBOUND → interno satisfaz InboundMessageV1', () => {
    const waEvent = normalizeEvolutionMessage(evolutionTextPayload);
    expect(waEvent).not.toBeNull();

    const normalized = normalizeGatewayInbound(waEvent!);
    const parsed = parseInboundMessageV1({
      specVersion: '1.0.0',
      externalMessageId: normalized.externalMessageId,
      externalConversationId: normalized.externalConversationId,
      content: normalized.content,
      sender: normalized.sender,
      senderType: normalized.senderType,
      contactPhone: normalized.contactPhone,
      contactName: normalized.contactName,
      sentAt: normalized.sentAt,
      mediaUrl: normalized.mediaUrl,
      mediaMimetype: normalized.mediaMimetype,
      mediaFilename: normalized.mediaFilename,
    });

    expect(parsed.ok).toBe(true);
  });

  it('WA_INBOUND canônico não é normalizado novamente como payload Evolution', () => {
    const canonical = normalizeEvolutionMessage(evolutionTextPayload);
    expect(canonical).not.toBeNull();

    const routed = toWAInboundEvent(canonical, 'WA_INBOUND');

    expect(routed).toBe(canonical);
    expect(routed?.payload.messageId).toBe('wamid.contract123');
    expect(routed?.payload.remoteJid).toBe('5511999999999@s.whatsapp.net');
  });

  it('mensagem de imagem preserva metadados de mídia no contrato', () => {
    const waEvent = normalizeEvolutionMessage(
      {
        event: 'MESSAGES_UPSERT',
        instance: 'cvg-desk',
        data: {
          key: { remoteJid: '5511999999999@s.whatsapp.net', id: 'wamid.img1', fromMe: false },
          pushName: 'Foto',
          message: {
            imageMessage: {
              caption: 'Olha a foto',
              url: 'https://example.com/foto.jpg',
              mimetype: 'image/jpeg',
            },
          },
          messageTimestamp: 1789176300,
        },
      },
    );

    expect(waEvent?.payload.type).toBe('image');
    const normalized = normalizeGatewayInbound(waEvent!);
    const parsed = parseInboundMessageV1({
      specVersion: '1.0.0',
      externalMessageId: normalized.externalMessageId,
      content: normalized.content,
      sender: normalized.sender,
      sentAt: normalized.sentAt,
      mediaUrl: normalized.mediaUrl,
      mediaMimetype: normalized.mediaMimetype,
    });
    expect(parsed.ok).toBe(true);
  });

  it('payload sem messageId gera event_id transitório mas payload.messageId vazio (rejeitado no use-case)', () => {
    const waEvent = normalizeEvolutionMessage(
      {
        event: 'MESSAGES_UPSERT',
        instance: 'cvg-desk',
        data: {
          key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
          message: { conversation: 'sem id' },
          messageTimestamp: 1789176300,
        },
      },
    );

    // Contrato do gateway preenche event_id transitório...
    expect(waEvent?.event_id).toMatch(/^evo_/);
    // ...mas o dedup canônico exige payload.messageId — handleGatewayInbound rejeita.
    expect(waEvent?.payload.messageId).toBe('');
  });
});
