# PROD-32 — Provar tracing real e corrigir smoke de integrações

**Observação da auditoria:** Aceites deste cartão ainda não encerrados; código existente deve ser revalidado e complementado, sem presumir ausência pela marca PLANNED.

**Tratamento:** IMPLEMENT_AND_VERIFY · REMAINING_SCOPE

**Achados:** OPS05

**Origem:** CVG-PRODUCTION-20260913 / PROD-32 / estado recebido PLANNED

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

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-32.test.mjs
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
