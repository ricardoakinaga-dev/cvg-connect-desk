import { authorizeConversationResource } from '/home/ricardo/cvg-connect-desk/packages/auth/src/resource-authz.ts';
async function main() {
 const result = await authorizeConversationResource({actor:{id:'synthetic-actor',roles:[]},action:'kanban:write',conversation:{id:'synthetic-conversation',sectorId:null,assignedUserId:'synthetic-actor'},requiredLevel:'write',isGlobalAdmin:async()=>false});
 console.log(JSON.stringify({case:'no-role actor assigned conversation, kanban write helper',result}));
}
main().catch(()=>{console.error('probe failed');process.exitCode=1});
