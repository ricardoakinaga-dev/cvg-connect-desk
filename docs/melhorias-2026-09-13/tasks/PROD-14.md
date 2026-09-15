# PROD-14 — Conectar mídia inbound à quarentena e acesso privado

**Observação da auditoria:** Ingressou pipeline real, URLs privadas e quarentena; recuperação após crash não está conectada ao runtime e exclui SCAN_FAILED.

**Tratamento:** REPAIR_AND_VERIFY · REWORK

**Achados:** BE-A04

**Origem:** CVG-PRODUCTION-20260913 / PROD-14 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

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

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-14.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Reproduzir o estado observado e os achados deste cartão no candidato congelado; separar correção, complemento e prova pendente.

**Sinal de conclusão da ação:** Reprodução/limites e subtarefas com aceites registrados, sem perder trabalho entregue.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
