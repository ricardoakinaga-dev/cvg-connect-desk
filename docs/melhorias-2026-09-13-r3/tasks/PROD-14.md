# PROD-14 — Conectar mídia inbound à quarentena e acesso privado

**Observação da auditoria:** Suíte R3 de PROD-14 executada em segmento próprio r3-prod14-20260914-a1; 13/13 passou com PostgreSQL/Redis isolados, moto S3-compatible e ClamAV reais. Revisão independente, staging externo e D05 permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** BE-A04, R3-BE02

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-14 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

**Dono funcional:** Backend mídia · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE16, BE15, UI04

**Dependências:** [PROD-07](PROD-07.md), [PROD-08](PROD-08.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/media/src`
- `modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts`
- `modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts`
- `apps/message-worker/src`
- `packages/database/supabase/migrations`
- `apps/desk-api/src/__tests__/production/prod-14.test.ts`

**Locks:** schema-migrations, worker-runtime

## Critérios de aceite

- **PROD-14-AC1** — Todo ingresso de mídia referencia asset privado com lifecycle; webhook não bloqueia em scan longo e nenhum consumidor lê URL bruta sem política. Pipeline processInboundMedia possui chamada produtiva real.
- **PROD-14-AC2** — Download e redirects revalidam destino/SSRF, MIME/magic e bytes; documentos só acessíveis CLEAN+STORED conforme contrato, infectado/pending/timeout/falha scanner nunca liberados.
- **PROD-14-AC3** — Idempotência por evento/asset e crash entre baixar/scan/store/publicar recuperáveis sem duplicação; MinIO/ClamAV reais clean/EICAR/timeout observados através de webhook→leitura.
- **PROD-14-AC4** — Dry-run de mídias legadas URLs/assets, migração para storage controlado e quarentena/revalidação conforme origem; impedir acesso inseguro enquanto pendente sem apagar histórico.
- **PROD-14-R2-AC5** — Conectar recuperação a worker/poller produtivo com claim, backoff, limites e métrica; incluir SCAN_FAILED retentável. Provar crash após commit antes enqueue, scanner indisponível→recuperado e ausência de starvation sem comando manual de migração.
- **PROD-14-R3-AC1** — PG isolado, pool10/lote50 e jobs normais concorrentes: todos progridem, nenhum connection timeout por auto-saturação; scanner lento, lease expiry, shutdown/restart, sem asset duplicado e retry budget só consumido por tentativas reais.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3 com PostgreSQL/Redis isolados, moto S3-compatible iniciado pelo run e ClamAV real em 127.0.0.1:53110 com EICAR; nenhum dado de produção..

13 testes passam sem skip; webhook→quarentena→scan→storage privado, SSRF/MIME/limites, scanner ausente/timeout, recovery, idempotência, dry-run e migração legada permanecem observáveis; revisão independente e staging externo continuam pendentes.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_RUNTIME_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3/evidencias/prod-14/r3-prod14-20260914-a1/runtime CVG_EVIDENCE_SEGMENT=r3-prod14-20260914-a1 AAA_RUN_ID=r3-prod14-20260914-a1 AAA_WORKER_INDEX=23 AAA_ATTEMPT=1 pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-14.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Suíte R3 executada em ambiente isolado com PG/Redis, moto S3-compatible real e ClamAV real; 13/13 testes passaram cobrindo quarentena, leitura privada, fail-closed, recovery, idempotência e migração legada. Revisão independente, staging externo e D05 permanecem pendentes.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-14/r3-prod14-20260914-a1/manifest.json, evidencias/prod-14/r3-prod14-20260914-a1/prod-14.test.log, evidencias/prod-14/r3-prod14-20260914-a1/prod-14-evidence.json, evidencias/prod-14/r3-prod14-20260914-a1/prod-14-ac4-dry-run.json, evidencias/prod-14/r3-prod14-20260914-a1/prod-14-ac4-migration.json, evidencias/prod-14/r3-prod14-20260914-a1/runtime/environment/isolated-env.json

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
