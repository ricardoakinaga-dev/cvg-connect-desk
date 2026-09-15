/**
 * PROD-14 — repro do ANTES (BE16): o inbound persistia a URL de mídia recebida
 * do provider em `messages.media_url` sem asset, sem quarentena e sem scan, e o
 * DTO devolvia a linha verbatim (a UI renderizava a URL crua diretamente).
 *
 * Usa o MESMO writer de produção (`persistInboundAtomically`) com o payload que
 * o use-case pré-PROD-14 repassava, e demonstra:
 *   1. `media_url` = URL crua do provider (referência direta);
 *   2. NENHUM media_asset/quarentena/scan associado (0 linhas);
 *   3. o DTO atual (sanitizado) anula a URL e expõe apenas o estado.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { persistInboundAtomically } from '../../../../modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts';
import { toSanitizedMessage } from '../../../../modules/chat/src/presentation/http/message-dto.ts';
import { db, schema } from '../../../../packages/database/src/index.ts';

const RAW_URL = 'http://provider.evil.invalid/raw/payload.png';

async function main(): Promise<void> {
  const externalMessageId = `prod14-repro-${randomUUID()}`;
  const persisted = await persistInboundAtomically({
    externalMessageId,
    externalConversationId: `prod14-repro-${randomUUID()}`,
    content: 'imagem inbound',
    sender: '+5511999990000',
    senderType: 'contact',
    // Pré-PROD-14: o use-case repassava a URL recebida exatamente assim.
    mediaUrl: RAW_URL,
    mediaType: 'image',
    mediaMimetype: 'image/png',
    mediaFilename: 'payload.png',
  });

  const message = persisted.message;
  const assets = await db
    .select()
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.messageId, message.id));
  const sanitized = toSanitizedMessage(message);

  const result = {
    generatedAt: new Date().toISOString(),
    externalMessageId,
    rawUrlPersisted: message.mediaUrl,
    rawUrlMatchesProvider: message.mediaUrl === RAW_URL,
    assetsLinked: assets.length,
    scanPerformed: false,
    dtoBefore: {
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
      metadata: message.metadata,
    },
    dtoAfterSanitization: {
      mediaUrl: sanitized.mediaUrl,
      mediaAssetId: sanitized.mediaAssetId,
      mediaState: sanitized.mediaState,
    },
  };
  console.log(JSON.stringify(result, null, 2));

  if (message.mediaUrl !== RAW_URL) throw new Error('repro: URL crua não foi persistida como no antes');
  if (assets.length !== 0) throw new Error('repro: inesperado asset/quarentena associado no antes');
  if (sanitized.mediaUrl !== null) throw new Error('repro: DTO atual deveria anular a URL crua');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
