# PROD-16 — Fechar escopo de privacidade e política por cópia

**Estado:** IMPLEMENTED · **Prioridade:** P1 · **Marco:** M1 · **Estimativa relativa:** 8

**Dono funcional:** Backend privacidade + responsável dados · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE20, BE05, BE19, OP08

**Dependências:** [PROD-01](PROD-01.md), [PROD-04](PROD-04.md), [PROD-06](PROD-06.md)

**Decisões:** D02

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/privacy/src`
- `modules/notes/src`
- `modules/alerts/src`
- `packages/database/supabase/migrations`
- `docs/LGPD_DATA_SUBJECT_REQUESTS.md`
- `apps/desk-api/src/__tests__/production/prod-16.test.ts`

**Locks:** schema-migrations

## Critérios de aceite

- **PROD-16-AC1** — GET/resume/export/erase sempre revalidam principal, permissão e escopo atual; requestId idempotente vinculado ator+contato+payload, reuso incompatível409 sem relatório alheio.
- **PROD-16-AC2** — Criação/retomada com checkpoint sob duas identidades, revogação no meio e crash não atravessa setor nem declara conclusão quando parcial; autor vem da sessão, incluindo alertas/notas.
- **PROD-16-AC3** — D02 ratifica retenção/finalidade/ação por contato,mensagem,nota,outbox,DLQ,asset,audit,logs,backup e relações tutor-paciente; inventário/dry-run podem avançar, mutação irreversível dependente só após decisão real.
- **PROD-16-AC4** — Exportação/residual scan e reaplicação de erasures após restore provam alcance; auditoria registra ator/correlação sem payload sensível integral e guarda recusas.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-16.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Escopo de privacidade, cópias e dry-run implementados; 9/9; D02 permanece OPEN.

**Sinal de conclusão da ação:** Revisor confirma requestId/retomada cross-scope e que nenhum erase irreversível ocorre sem D02/confirmação.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-16/RELATORIO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
