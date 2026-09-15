/**
 * PROD-11/AC3: process that is killed between provider request and callback.
 * The test materializes this fixture inside the run evidence directory.
 */
import { gatewayService } from '@cvg/gateway-adapter';
import { sendOutboundMessage, setGatewayOutboundPort } from '@cvg/chat';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`PROD-11 crash child: env ${name} obrigatorio`);
  return value;
}

async function main(): Promise<void> {
  setGatewayOutboundPort(gatewayService);
  const result = await sendOutboundMessage({
    conversationId: required('CRASH_CONVERSATION_ID'),
    content: process.env.CRASH_CONTENT ?? 'prod-11 crash window',
    recipient: process.env.CRASH_RECIPIENT ?? '+5511900000822',
    senderType: 'human',
    userId: process.env.CRASH_ACTOR_ID,
    idempotencyKey: required('CRASH_IDEMPOTENCY_KEY'),
  });

  if (result.isErr()) {
    console.error(JSON.stringify({ phase: 'error', message: result.error.message }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    phase: 'done',
    outcome: result.value.outcome,
    messageId: result.value.messageId,
  }));
  process.exit(0);
}

main().catch((error) => {
  console.error(JSON.stringify({ phase: 'fatal', message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
