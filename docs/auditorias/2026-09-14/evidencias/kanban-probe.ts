import { db, schema } from '/home/ricardo/cvg-connect-desk/packages/database/src/index.ts';
import { conversationRepository } from '/home/ricardo/cvg-connect-desk/modules/chat/src/infrastructure/repositories/conversation.repository.ts';
async function main() {
 const [conversation] = await db.insert(schema.conversations).values({status:'open', statusV2:'novo', isActive:true}).returning();
 await conversationRepository.updateStatusV2(conversation.id, 'finalizado');
 const reopened = await conversationRepository.updateStatusV2(conversation.id, 'em_atendimento');
 console.log(JSON.stringify({case:'finalizado -> em_atendimento',status:reopened.status,statusV2:reopened.statusV2,isActive:reopened.isActive,hasClosedAt:!!reopened.closedAt}));
 process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
