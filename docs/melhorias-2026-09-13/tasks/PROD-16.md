# PROD-16 — Fechar escopo de privacidade e política por cópia

**Observação da auditoria:** Nova erasure passou9/9 com PG atual; anonymize legado executa mutação sem a mesma política/escopo/checkpoint.

**Tratamento:** REPAIR_AND_VERIFY · REWORK

**Achados:** BE-A05

**Origem:** CVG-PRODUCTION-20260913 / PROD-16 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

**Dono funcional:** Backend privacidade + responsável dados · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE20, BE05, BE19, OP08

**Dependências:** [PROD-01](PROD-01.md), [PROD-06](PROD-06.md)

**Decisões:** D02

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/privacy/src`
- `modules/notes/src`
- `modules/alerts/src`
- `packages/database/supabase/migrations`
- `docs/LGPD_DATA_SUBJECT_REQUESTS.md`
- `apps/desk-api/src/__tests__/production/prod-16.test.ts`

**Locks:** schema-migrations, auth-contract

## Critérios de aceite

- **PROD-16-AC1** — GET/resume/export/erase sempre revalidam principal, permissão e escopo atual; requestId idempotente vinculado ator+contato+payload, reuso incompatível409 sem relatório alheio.
- **PROD-16-AC2** — Criação/retomada com checkpoint sob duas identidades, revogação no meio e crash não atravessa setor nem declara conclusão quando parcial; autor vem da sessão, incluindo alertas/notas.
- **PROD-16-AC3** — D02 ratifica retenção/finalidade/ação por contato,mensagem,nota,outbox,DLQ,asset,audit,logs,backup e relações tutor-paciente; inventário/dry-run podem avançar, mutação irreversível dependente só após decisão real.
- **PROD-16-AC4** — Exportação/residual scan e reaplicação de erasures após restore provam alcance; auditoria registra ator/correlação sem payload sensível integral e guarda recusas.
- **PROD-16-R2-AC5** — Eliminar bypass da rota legada /privacy/contacts/:id/anonymize: mesma política, escopo atual, recibo/checkpoint e confirmação da erasure, ou bloqueio seguro. Com D02 OPEN/default dry-run não ocorre mutação irreversível; ator de A não altera cópias em B. Falha entre contato/mensagens/audit seguida de retry converge. Testar HTTP+PG próprio.
- **PROD-16-R2-AUTH** — Usar o contrato C02 existente e coordenar alterações compartilhadas com PROD-04 via lock auth-contract. Correção do bypass legado avança após PROD-01/06, sem aguardar aceite global de autorização; G02 só fecha após provas de PROD-04 e PROD-16.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-16.test.ts
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
