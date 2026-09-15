# PROD-31 — Endurecer logs, PII e métricas operacionais

**Observação da auditoria:** Handler metrics autenticado confirmado503/401/200, mas realtime CLI falha. Completar métricas/PII/dashboard com processo nativo restaurado e scrape real.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-31 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M3 · **Estimativa relativa:** 5

**Dono funcional:** Backend observabilidade · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE19, OP12, BE14, BE20, BE11

**Dependências:** [PROD-09](PROD-09.md), [PROD-13](PROD-13.md), [PROD-16](PROD-16.md), [PROD-18](PROD-18.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-api/src/app.ts`
- `apps/message-worker/src`
- `apps/realtime-service/src`
- `packages/shared/src`
- `modules/secretary-adapter/src`
- `apps/desk-api/src/__tests__/production/prod-31.test.ts`

**Locks:** api-composition, realtime-runtime, worker-runtime

## Critérios de aceite

- **PROD-31-AC1** — Redaction recursiva cobre previews, objetos aninhados, erros de provider e console; não vazar token/email/phone/content em logs/traces/labels de métricas.
- **PROD-31-AC2** — /metrics protegido e labels por rota normalizada/valores finitos; 404/IDs aleatórios não criam cardinalidade ilimitada; carga confirma orçamento antes/depois.
- **PROD-31-AC3** — Métricas detectam backlog/idade/lease/retry/DLQ/processamento worker, atraso realtime e degradação; correlação/causação ligam eventos sem PII.
- **PROD-31-AC4** — Falha de exportação/observabilidade não derruba negócio, porém detectável; logs e audit de segurança cobrem sucesso/negação/falha e retenção D02.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-31.test.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Handler metrics autenticado confirmado503/401/200, mas realtime CLI falha. Completar métricas/PII/dashboard com processo nativo restaurado e scrape real. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
