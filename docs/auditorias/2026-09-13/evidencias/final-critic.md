# Crítica final independente I1 — 2026-09-13

Decisão produto: **REJECT** contra a barra documental congelada. Há implementação substancial, mas há descumprimentos demonstráveis por código conectado. A ausência de DB/CI atuais é adicionalmente **BLOCKED para certificação runtime**, não o único motivo da rejeição. Não foram alteradas fontes nem executados testes nesta revisão.

## Método e precedência

Leitura independente de AUTHORIZATION.md, MESSAGING_CONTRACTS.md, AI_SAFETY.md, 08-frontend-architecture.md, 10-realtime-and-events.md e TRIPLE_AAA_CERTIFICATION.md; rastreamento de composição, controllers, use cases, repositórios, worker, realtime e Inbox. Nenhum parecer anterior, .gauntlet, relatório de notas ou retorno builder foi lido.

AUTHORIZATION/MESSAGING/AI_SAFETY e regras obrigatórias de 08/10 são critérios normativos. Trechos “estado atual” são afirmações verificáveis, não evidência. TRIPLE_AAA_CERTIFICATION registra baseline antigo identificado por SHA 524d6509; seu próprio estado final é NOT_YET_CERTIFIED. “Nenhum blocker de código permanece” não pode ser transportado para o checkout atual. docs08 §2 afirma realtime conectado, mas §18 o nega; docs10 §2 também o nega. A implementação resolve a contradição factual: Inbox conecta realtime. Não reduzir nota por “realtime ausente”.

## Seis fronteiras

| Critério | Status | Nota de implementação sugerida | Confiança |
|---|---|---:|---|
| Ação + recurso no acesso HTTP/WS | FAIL em listagem HTTP; detalhe e WS substanciais | 70 | Alta, estática |
| Atomicidade, dedup e recuperação de eventos/envio | Substancial; runtime atual não comprovado | 80 | Média-alta, estática |
| Mídia CLEAN ponta a ponta | FAIL inbound; outbound condicionado a CLEAN conectado | 55 | Alta, estática |
| IA limitada e ferramentas aprovadas | FAIL budget por conversa; registry desconectado | 50 | Alta, estática |
| UX operacional/reconciliação e arquitetura frontend | Substancial, com lacunas e dívida de composição | 75 | Média-alta |
| Gates e certificação atual | Infraestrutura presente; certificação BLOCKED | 65 | Alta quanto à distinção evidência/claim |

Notas são sugestões por fronteira, não média global nem substitutos dos gates. Escala aplicada: 0 ausente, 25 esqueleto, 50 parcial, 75 substancial com lacunas, 90 completo testado de forma limitada, 100 completo comprovado.

### 1. Autorização: listagem pode dispensar permissão da ação

`apps/desk-api/src/app.ts:644` registra `registerOutboundController`. Em `modules/chat/src/presentation/http/outbound.controller.ts`, GET `/conversations` tem apenas `authenticate`. Com `sectorId`, chama `authorize(..., 'chat:read', ...)`; sem esse filtro, testa apenas memberships para não-admin. `conversationRepository.findPage` chama `buildConversationConditions` (`modules/chat/src/infrastructure/repositories/conversation.repository.ts:98`), que filtra IDs de setores sem testar chat:read. Logo, uma sessão autenticada com membership e sem permissão de leitura alcança dados de conversas/últimas mensagens na listagem sem filtro. É ausência de enforcement por ação em caminho real, não ausência de helper.

Há ainda uma janela entre a checagem de memberships no controller e a segunda leitura no repositório: se todos os vínculos forem removidos entre elas, `buildConversationConditions` deixa de adicionar filtro quando a segunda consulta retorna zero. Tratar como risco de corrida deduzido, não exploração reproduzida.

Correção de interpretação: detalhe de mensagens, envio e upload usam `authorizeConversationResource` e exigem permissões. `apps/realtime-service/src/authorization.ts` exige chat:read e autorização de recurso para conteúdo, e `index.ts` aplica subscription/delivery/revalidation; não é correto chamar todo o RBAC/realtime de inexistente.

### 2. Atomicidade e recuperação: trabalho real conectado

`receive-inbound-message.use-case.ts:67` chama `persistInboundAtomically`; o repositório abre `db.transaction` em linha 78 e persiste intenções de outbox no mesmo executor (110, 140). `send-outbound-message.use-case.ts:145` chama `persistOutboundIntentAtomically`; `outbound-atomic.repository.ts:192` usa transação, advisory lock (195), fingerprint e outbox (317). Há diferenciação explícita de entrega incerta em `send-outbound-message.use-case.ts:224-279`.

`packages/events/src/outbox-lease.ts` implementa claim condicional, owner/generation, ack/nack cercados e DLQ transacional. `apps/message-worker/src/index.ts:339-353` efetivamente reivindica e processa leases; `dead-letter.ts:38` preserva sourceEvent. Isso sustenta “substancial”, não “apenas contratos” ou “só publisher em memória”. Inspeção estática não comprova concorrência real, recuperação após crash ou comportamento de provider. Não foi demonstrado FAIL desses mecanismos nesta amostra, nem PASS runtime.

### 3. Mídia: garantia CLEAN só fecha outbound

Caminho inbound: `app.ts:643` registra webhook → `webhook-inbound.controller.ts:84` chama `receiveInboundMessage` → use case linhas 41-54 faz `validateMedia` de metadados/URL → linha 74 repassa mediaUrl → `inbound-atomic.repository.ts:126` persiste URL. GET histórico retorna mensagens, e `Inbox.tsx:1163-1171` usa URL não-asset diretamente em `<img>`/`<audio>`. Esse caminho não exige scanStatus CLEAN. Busca por `processInboundMedia` em apps/modules/packages, excluindo testes, encontrou somente a definição em `packages/media/src/index.ts:92`.

Em contraste, upload dedicado chama `ingestUploadedMedia`; `packages/media/src/index.ts:367-385` só armazena para entrega após CLEAN, e resolver em 409-419 verifica CLEAN+STORED+prefixo+conversa. Envio rejeita mídia arbitrária sem mediaAssetId. Portanto, não classificar “pipeline media ausente”; classificar fronteira inbound sem garantia conectada. Scanner/storage reais também não foram verificados nesta revisão.

### 4. IA: budget por conversa e tool registry não cumprem claim

`invoke-secretary.use-case.ts:45-54` chama evaluateAIPolicy antes de `client.invoke`, mas passa `priorInvocations: 0`. `ai-policy.ts:132` compara esse valor ao máximo por conversa, portanto esse limite não cresce no fluxo real. Tamanho de conteúdo/histórico e deny de ação desconhecida estão conectados.

Busca em apps/modules/packages excluindo testes encontrou `invokeAITool` e `decideApproval` apenas definidos em `ai-tools.ts`, sem caller de produção. Registry/aprovação persistida existem como implementação isolada; não há prova do “ponto único” integrado afirmado por AI_SAFETY. Não alegar que ferramenta perigosa é atualmente executada sem aprovação: não foi encontrado executor integrado.

Adicionalmente, `hashToolArgs` em `ai-tools.ts:40-41` calcula hash sobre `sanitizeAIArgs`, que substitui telefone/email e trunca conteúdo; argumentos distintos podem compartilhar hash. `ai-policy.ts:80-109` preserva preview e valores aninhados, logo o sanitizador tampouco garante genericamente “sem PII”. São limitações do mecanismo preparado, não demonstração de vazamento em um fluxo de tool atualmente conectado.

### 5. UX operacional: substancial, com limites verificáveis

`Inbox.tsx:472-516` conecta realtime e eventos; há fallback/revalidação, erros operacionais e status reconexão (1217-1218). Estados pending/unknown/failed preservam intenção e rascunho; retorno incerto é distinguido (695-701), e falha definitiva informa necessidade de nova intenção (388). Não afirmar “UI só mock/polling” nem “falhas silenciosas em todos os fluxos”.

Lacunas: mídia persistida como asset:// resulta somente em chip de nome (1173-1175), sem visualização/download nessa timeline; imagem/audio inbound renderiza sem gate CLEAN. A página tem mais de 1.200 linhas e concentra conexão, consultas e orquestração de envio/upload, contrariando a separação exigida em docs08 §8/§13. Testes frontend 260/260 foram informados pelo líder como execução atual, mas não substituem browser visual/a11y real. Não executei navegador.

### 6. Gates: existência não equivale a execução atual

`.github/workflows/ci.yml` contém jobs de lint/typecheck/unit/integration/migrations/build/coverage e composição do gate; há workflows staging-integrations, smoke-e2e e triple-aaa-certification. Exemplo de limite de escopo: coverage em ci.yml:139 roda `@cvg/shared`; não interpretar aquele job sozinho como cobertura global do produto.

Evidência atual informada pelo líder: Node24/pnpm10; lint e typecheck 33/33; frontend 260/260. São checks válidos e limitados. Sem DB atual, CI remota, MinIO/ClamAV reais, browser e provas operacionais atuais, não cabe certificação total ou 90–100 generalizado. O baseline narrado em TRIPLE_AAA_CERTIFICATION não prova o checkout atual.

## Conclusão auditável

REJECT produto pela autorização incompleta da listagem, mídia inbound sem CLEAN conectado e budget/registry IA incompletos. BLOCKED certificação runtime pelos gates externos não demonstrados. A amostra contém implementação real e sofisticada em envio, transações, leases, autorização por recurso e UX; rejeição não equivale a esqueleto. Este parecer não é auditoria exaustiva nem prova de ausência de outros defeitos.
