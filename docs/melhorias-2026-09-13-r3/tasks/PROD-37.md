# PROD-37 — Ensaiar backup/restore durável e privacidade pós-desastre

**Observação da auditoria:** OPS08 OPEN: scripts DR ainda usam nomes fixos destrutivos/checksum opcional. Preparar segurança de namespace e provar restore completo em ambiente próprio.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS08

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-37 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M4 · **Estimativa relativa:** 8

**Dono funcional:** SRE dados + privacidade · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP08, OP06, BE20, DT01

**Dependências:** [PROD-06](PROD-06.md), [PROD-16](PROD-16.md), [PROD-36](PROD-36.md), [PROD-25](PROD-25.md)

**Decisões:** D02

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `infra/scripts/pg-backup.sh`
- `infra/scripts/pg-restore.sh`
- `infra/scripts/dr-e2e.sh`
- `infra/scripts/dr-e2e-node.mjs`
- `.github/workflows/dr-e2e.yml`
- `docs/DISASTER_RECOVERY.md`
- `docs/RUNBOOK.md`
- `scripts/production/prod-37.test.mjs`

**Locks:** deploy-ci

## Critérios de aceite

- **PROD-37-AC1** — Backup real durable com checksum exigido/verificado, encryption/access/retention/offsite conforme política, scheduler e observação de idade; falta/checksum inválido/corrupção bloqueiam restore.
- **PROD-37-AC2** — Ensaio em namespace com marcador: restaurar backup de banco populado (inclui sessions,acks,outbox,DLQ,assets/links e política); não substituir dump por SELECT→memória→INSERT.
- **PROD-37-AC3** — Integridade/contagens/hash e constraints antes/depois, migration/boot/readiness e fluxo browser pós-restore; readiness false ou dados perdidos reprovam; erasures reimplementadas antes de expor backup restaurado.
- **PROD-37-AC4** — RPO<=24h/RTO<=2h medidos, procedure por segundo operador, teardown só recursos run. Retention/erro/falta espaço/backup antigo e recuperação parcial exercitados sem tocar produção.
- **PROD-37-R2-AC5** — Remover DROP em bancos de nome fixo; recusar recurso sem marcador/owner. Checksum é obrigatório; conferir todas entidades/outbox/DLQ/mídia/erasures, não só grep de uma tag. Provar restore durável com segundo operador.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-37.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

OPS08 OPEN: scripts DR ainda usam nomes fixos destrutivos/checksum opcional. Preparar segurança de namespace e provar restore completo em ambiente próprio. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
