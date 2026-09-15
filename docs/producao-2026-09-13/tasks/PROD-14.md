# PROD-14 — Conectar mídia inbound à quarentena e acesso privado

**Estado:** IMPLEMENTED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

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

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-14.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

AC4 de midia legada entregue (dry-run/migracao/revalidacao) e lint zerado; 12/12. MinIO permanece BLOCKED com dono.

**Sinal de conclusão da ação:** Critico reproduz dry-run sem mutacao e migracao idempotente com pendente indisponivel.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-14/RELATORIO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
