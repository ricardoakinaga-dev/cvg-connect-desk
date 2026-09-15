# Auditoria independente backend — 2026-09-13

Veredito: **NOT_READY**. O código contém entregas substanciais, mas IMPLEMENTED não equivale a VERIFIED. Esta rodada read-only não executou PG, Redis, MinIO, ClamAV ou provedores; nenhum dado existente foi acessado/mutado. Fonte observada: HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree extenso; provas históricas dos cards não foram promovidas a atuais.

Método: contratos C01–C10, CRITERIOS/G01–G12 e aceites PROD04–16/18; skill backend-patterns + referências idempotency/transaction-patterns/security-boundaries. Prioridade = impacto no contrato, não nota anterior. CURRENT abaixo significa código observado nesta rodada; PROPOSED é correção sugerida. Não é certificação de segurança/release. Nenhuma ferramenta externa ou subagente foi usado nesta lane.

## Evidência executada atual

- `pnpm --filter @cvg/auth exec vitest run src/__tests__/session-policy.test.ts src/__tests__/rbac-effective.test.ts`: **25 PASS**, 0 skip; log `auth-tests.log`. Negativos de limite exato e permissões autoritativas vazias; prova pura, não HTTP/PG.
- `pnpm --filter @cvg/message-worker exec vitest run src/__tests__/health.test.ts src/__tests__/polling.test.ts`: **4 PASS**, 0 skip; log `worker-tests.log`. HTTP localhost efêmero de health/readiness e exclusão de ciclo; não prova fila real.
- `node /tmp/cvg-audit-deliveries-ufq9_ejh/backend/probes.cjs`: execução do TypeScript atual transpilado com datastore simulado, sem DB/rede. `probe-results.json` contém hashes das fontes e resultados: retry com assinatura renovada → mismatch; invocação unknown → processing. São probes de lógica do código real, **não** prova de persistência ou integração pública.
- Revisão conectada de controllers → use-cases → repositórios, worker → processador → efeitos e leitura das migrations. Suítes production usam PG/serviços, portanto NOT_RUN nesta lane. Lead detém typecheck/lint/web.

## Achados materiais

### BE-A01 — P1 — Secretary reabre estado unknown e refaz chamada externa

**Confiança alta; CURRENT por revisão conectada + probe da função real com store simulado.**

`modules/secretary-adapter/src/infrastructure/repositories/secretary-invocation.repository.ts:184` trata apenas denied/completed como terminais; `:192` converte qualquer outro estado, inclusive unknown e processing, em processing, incrementa attemptCount e apaga lastError/errorCode. `modules/chat/src/application/use-cases/execute-inbound-secretary.use-case.ts:251` classifica falha ambígua, persiste unknown e relança erro; `apps/message-worker/src/processor.ts:225` entra no retry. Na próxima tentativa o fluxo chega novamente a processMessageWithSecretary. Probe observou unknown→processing, alreadyCompleted=false e perda da causa.

**Impacto:** timeout/5xx após processamento remoto pode provocar nova IA/custo/efeito; crash após envio antes de completar invocação pode recalcular resposta diferente e colidir no fingerprint outbound. O recibo local não é reconciliação externa. `packages/integrations/src/secretary-client.ts:58` envia POST sem invocationKey ou contrato explícito de idempotência remota.

**PROPOSED:** preservar unknown como bloqueio de reexecução automática; obter reconciliação/idempotência oficial ou criar etapa durável de resultado com referência, separando IA de entrega. `processing` também precisa owner/generation/checkpoint para impedir dois executores após lease expirado. Provar timeout após efeito, crash após IA/antes gravação e redelivery concorrente. PROD10-AC2/3, PROD13, G03/G05.

### BE-A02 — P1 — Retry de webhook com timestamp renovado é rejeitado como payload diferente

**Confiança alta; CURRENT com probe + SQL inspecionado.**

`packages/shared/src/webhook-guard.ts:235` deriva signatureHash da assinatura HMAC; a assinatura inclui timestamp. `packages/shared/src/webhook-anti-replay.ts:243` exige assinatura **e** payload iguais. Evento failed com conteúdo idêntico mas timestamp/HMAC novos retorna mismatch. Probe: claimed_new → fail → nova assinatura/mismo payload = mismatch; assinatura original = claimed_retry. Depois de 300s a assinatura original passa a falhar pelo skew, de modo que uma entrega pendente pode ficar sem retry viável, dependendo do contrato real de redelivery.

**PROPOSED:** autenticar cada tentativa pelo timestamp/HMAC atual; deduplicar identidade+origem+payload canônico estável, não a assinatura transitória. Exigir mismatch quando payload mudar, aceitar retry quando só timestamp/assinatura forem atualizados. Gateway oficial/sandbox continua necessário para fechar AC4. PROD07-AC1/2/3, G03.

### BE-A03 — P2 — Duplicata já commitada ainda recebe 409 contra o contrato C03

**Confiança alta; CURRENT estático, HTTP não executado.**

`packages/shared/src/webhook-guard.ts:243`–`:265` responde 409 `duplicate_event_id` para completed. `CONTRATOS.md` C03 exige evento já aplicado → 2xx idempotente. O negócio não é duplicado (positivo), mas ACK perdido seguido de retry resulta em erro permanente e pode alimentar retries/DLQ do produtor.

**PROPOSED:** retornar o ACK idempotente estável ou ratificar contrato real incompatível antes de alterar documentação; guardar resultRef do recibo se necessário. Não remover HMAC/skew para resolver. PROD07-AC4/G03.

### BE-A04 — P1 — Recuperação de mídia não é acionada pelo runtime e exclui SCAN_FAILED

**Confiança alta; CURRENT por mapa completo de callers.**

`modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts:139` agenda trabalho em memória após persistência; o pipeline mantém `inflight` local em `inbound-media-pipeline.ts:257`. `recoverPendingInboundMedia` em `:325` tem caller apenas em `legacy-media-migration.ts:325` e testes; busca global não encontrou boot/poller/worker/comando operacional conectado à recuperação. Logo crash entre commit e enqueue deixa mídia pendente até chamada manual da função. Além disso `inbound-media-pipeline.ts:335` seleciona somente PENDING_SCAN/FAILED, enquanto falha real de scanner produz SCAN_FAILED (`:250`): esse estado jamais entra na própria recuperação proposta. Falha é fail-closed (bytes não liberados), mas atendimento fica sem mídia.

**PROPOSED:** conectar recuperação durável ao worker/poller com backoff, limite e observabilidade; incluir SCAN_FAILED retentável e evitar starvation de primeiras linhas permanentemente indisponíveis. Provar crash pós-commit/pré-enqueue, scanner indisponível→recuperado e reinício real. PROD14-AC3/G04. Não adicionar broker: fila PG/estado existente é baseline suficiente.

### BE-A05 — P1 — Endpoint legado de anonimização contorna política e escopo de mutação

**Confiança alta no caminho estático; HTTP/PG não executado.**

`modules/privacy/src/presentation/http/privacy.controller.ts:406` mantém `/privacy/contacts/:id/anonymize`; `:431` verifica apenas se o contato possui algum vínculo dentro do escopo e `:445` chama `anonymizeContactData` sem passar escopo/política/confirmIrreversible. `modules/privacy/src/application/data-subject-service.ts:143` altera PII global; `:157` carrega **todas** as conversas do contato e `:164` altera remetentes em todas elas. Não há transação englobando contato/mensagens/audit, nem vínculo idempotente de requestId. `privacy-policy.ts:4` declara D02 não aprovada/default dry-run, mas este caminho não consulta a política.

**Impacto:** um ator com admin:write setorial e contato compartilhado pode alterar cópias de mensagens em outro setor; mesmo global, o endpoint executa alteração irreversível fora da política dry-run/checkpoints. Falha após UPDATE contacts perde o telefone original necessário à limpeza de sender no retry. A nova rota erasure mais robusta não elimina o bypass legado.

**PROPOSED:** rotear anonimização legada pelo mesmo núcleo de política, escopo, confirmação, transação/checkpoint e recibo da erasure, ou bloquear mutação enquanto D02 estiver OPEN. Testar contato compartilhado A/B, ator A, modo dry-run, falha após primeira escrita e retry. PROD16-AC1/2/3/4, G02/G05.

### BE-A06 — P1 — CAS é opcional e cliente atual não envia versão

**Confiança alta no contrato estático; corrida HTTP/PG não executada.**

`modules/chat/src/application/use-cases/conversation-operations.use-case.ts:67` retorna true quando expectedUpdatedAt está ausente. Campos expectedStatusV2/expectedAssignedUserId/expectedHandler também são opcionais. `modules/chat/src/presentation/http/conversation-operations.controller.ts:70`, `:124`, `:176` exigem apenas novo estado/assignee/handler. Busca em apps/desk-web/src não encontrou nenhum expectedUpdatedAt/expectedStatus/expectedHandler/expectedAssigned. SELECT FOR UPDATE serializa escrita, porém não impede operador antigo de sobrescrever uma alteração já commitada sem precondição.

**PROPOSED:** exigir versão/precondição no endpoint operacional e propagá-la do DTO ao web, com 409/428 e refresh em conflito; usar versão inteira ou token que preserve precisão em vez de depender do Date truncado. Provar dois operadores: B salva, A envia estado antigo e recebe conflito sem sobrescrita. PROD18-AC3/G06.

## Positivos atuais e status por entrega

Nenhum card abaixo foi promovido a VERIFIED porque os aceites exigem integração que não foi reexecutada. “Código coerente” não é PASS do gate.

| PROD | Estado da auditoria | Positivos CURRENT | Pendência obrigatória |
|---|---|---|---|
| 04 | NOT_RUN integração; revisão parcial favorável | GET conversations exige chat:read em outbound.controller:208; query restringe userId não global em conversation.repository:119; permissões autoritativas vazias negam (7 testes PASS) | Matriz completa HTTP/WS, revogação entre check/query, entrega socket <=5s atual |
| 05 | NOT_RUN integração; 18 testes puros PASS | Política 7d/30d/24h e limites exatos; rotateSession usa transaction e lock | Login/logout/rotate concorrente HTTP+PG, WS e timezone reais |
| 06 | NOT_RUN fresh/upgrade | schema sessions timezone:true; migration0023; check-migrations hashes e drift de objetos/datas | Upgrade populado/fresh/interrupção reais. 0023 created_at presume timezone histórico igual ao timezone da migration, conforme próprio comentário; validar com metadados do ambiente antes de rodar |
| 07 | FAIL | claim/fail/complete e erro de store propagado; persistência antecede complete | BE-A02/A03 + Gateway real |
| 08 | NOT_RUN PG; revisão parcial favorável | inbound-atomic:145 lock por externalConversationId; DuplicateInboundRaceError aborta perdedora; contato+mensagem+history+outbox tx; hints pós-commit; dry-run de órfãos | Corridas com/sem ID, rollback em cada escrita e paginação empatada reais |
| 09 | NOT_RUN PG/processos; revisão parcial favorável | handlers:84 propaga Err; alerts create-alert:102 efeito+receipt+outbox tx; processor observa stale ACK/NACK | Crash/restart, poison/DLQ, leases reais; 4 testes puros de saúde/poll não substituem |
| 10 | FAIL | Secretary saiu do webhook; message.persisted é intenção durável; outbound usa caminho C05 | BE-A01; race de handoff entre última leitura e envio ainda requer prova; provedores oficiais |
| 11 | NOT_RUN PG/provider; revisão parcial favorável | outbound-atomic:192 tx+lock por ator/conversa/chave; fingerprint canônico; tombstone e writer legado; unknown explícito | Callback/restart/TTL/timeout e sandbox oficial |
| 12 | NOT_RUN PG/Redis/3 processos | outbox-lease tem owner/generation em renew/ACK/NACK e consumers separados | Failover/partição/reconnect e DLQ admin real; runtime worker reclama lote50 sequencial com lease120s, sem renew conectado observado; investigar sob provider lento |
| 13 | Parcial; FAIL na fronteira async | beginSecretaryInvocation serializa budget por conversa; conta store durável; tools desabilitadas por default com D05 OPEN; hash original canônico e aprovação CAS | BE-A01; concorrência/restart real do budget e approvals; não anunciar tools habilitadas |
| 14 | FAIL | processInboundMedia tem caller real; media_url crua não é persistida; DTO remove mediaIntake/sourceUrl; asset só após clean/stored | BE-A04 + scanner/storage/recovery reais |
| 15 | NOT_RUN infraestrutura | DTO asset privado e pipeline compartilhado; não foi observado bypass por URL nesta revisão limitada | Exatos16MiB/overhead/proxy/ClamAV/S3, revogação leitura/signed URLs reais |
| 16 | FAIL | Novos endpoints erasure fazem escopo atual e vinculação de operação; política nova default dry-run | BE-A05; restore/reaplicação residual e ratificação D02 |
| 18 | FAIL | Operações centralizadas, transações, history/audit/outbox; row lock e precondição quando enviada | BE-A06; matriz completa de auditoria/transfers e rollback reais |

## Plano priorizado proposto

1. Bloquear caminhos que violam invariantes: Secretary unknown/retry, anonymize legado e retry webhook timestamp; congelar testes negativos reproduzindo antes de corrigir. Reaproveitar transaction/receipt existentes; rejeitar arquitetura nova ou broker sem necessidade.
2. Conectar mídia recovery e tornar CAS obrigatório entre backend/web. Provar falhas/restart com processos e serviços isolados; nenhum recurso existente deve ser limpo por teste.
3. Reexecutar PROD04–16/18 no mesmo candidato e manifesto; distinguir PG real, mocks locais, scanner real e sandbox oficial. Preservar BAR G01–G12/44 cards, sem usar 29 testes puros como denominador de cobertura.
4. Ratificar D02/D05/D03 nos donos de dados/produto, mantendo bloqueadas apenas ações dependentes; aplicar controles técnicos independentes imediatamente. Não transformar flag de ambiente em ratificação humana fictícia.
5. Fechar prova operacional de renewal/backpressure sob batch50 e provider lento, downgrade/upgrade/timezone histórico e restore+erasure. Implementação observada é um progresso, porém nenhum release deve ser inferido desta rodada.

Limitações: análise bounded, sem garantia de ausência de outros defeitos; cobertura completa de authz endpoint-by-endpoint, schema inteiro e audit matrix permanece pendente. Migrations históricas não foram executadas. Logs/probes mostram somente esta rodada; números antigos citados nos cards não foram contados. Todos os artefatos desta lane ficam em /tmp; produto/docs intactos.
