# PROD-32 — Provar tracing real e corrigir smoke de integrações

**Observação da auditoria:** OPS05 OPEN: smoke com DeleteObjectCommand sem import, tolerância via ||true e expectativaHEAD incorreta. Tracing/storage/scanner reais não exercitados.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS05, R3-BE02

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-32 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M3 · **Estimativa relativa:** 8

**Dono funcional:** Plataforma tracing + QA integração · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP13, OP14, BE19, OP09

**Dependências:** [PROD-31](PROD-31.md), [PROD-36](PROD-36.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `packages/tracing/src`
- `scripts/otel-e2e-check.mjs`
- `scripts/staging-smoke.mjs`
- `.github/workflows/staging-integrations.yml`
- `docker-compose.yml`
- `docker-compose.staging.yml`
- `infra/otel`
- `scripts/production/prod-32.test.mjs`

**Locks:** deploy-ci

## Critérios de aceite

- **PROD-32-AC1** — Staging smoke importa DeleteObjectCommand, interpreta HEAD 404 corretamente, remove tautologia || true e rejeita indisponibilidade/credencial/arquivo errado.
- **PROD-32-AC2** — Compose fornece OTEL_* realmente aos runtimes; usar Collector/armazenamento reais configurados, sem substituir endpoint por receptor de teste no aceite E2E.
- **PROD-32-AC3** — Transação webhook→API→DB→outbox→worker→Gateway/Secretary sandbox→realtime produz spans correlacionados consultáveis no backend de traces, com erro/timeout e campos sem PII.
- **PROD-32-AC4** — MinIO put/get/delete/signed expiry e ClamAV CLEAN/EICAR/timeout comprovados com serviços reais; portas abertas ou strings num span sintético não satisfazem gate.
- **PROD-32-R3-AC1** — PG isolado, pool10/lote50 e jobs normais concorrentes: todos progridem, nenhum connection timeout por auto-saturação; scanner lento, lease expiry, shutdown/restart, sem asset duplicado e retry budget só consumido por tentativas reais.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-32.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

OPS05 OPEN: smoke com DeleteObjectCommand sem import, tolerância via ||true e expectativaHEAD incorreta. Tracing/storage/scanner reais não exercitados. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
