# PROD-33 — Implantar SLOs, alertas e validar capacidade

**Observação da auditoria:** R3-OP01 aberto: gate aceita medições nulas/excedentes/futuras. Não há nova carga real/SLO/SQL medido; manter orçamentos congelados.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS03, R3-OP01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-33 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M4 · **Estimativa relativa:** 13

**Dono funcional:** SRE desempenho + frontend · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP15, BE17, OP12, UI09, UI16

**Dependências:** [PROD-12](PROD-12.md), [PROD-29](PROD-29.md), [PROD-30](PROD-30.md), [PROD-32](PROD-32.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/SLO.md`
- `infra/prometheus`
- `infra/grafana`
- `infra/scripts/query-performance.mjs`
- `e2e/load`
- `scripts/production`
- `scripts/production/prod-33.test.mjs`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-33-AC1** — Reescrever SLIs válidos e orçamento com janela explícita: dedup inofensiva não é efeito duplicado; 30 dias: API 99.9%=43min12s e webhook 99.95%=21min36s. Provar queries/rules com falha e recuperação.
- **PROD-33-AC2** — Dashboards reais versionados, burn-rate 1h/6h e receptor/simulador de alerta; fila parada, erro webhook, dependência crítica e atraso WS disparam e resolvem com runbook.
- **PROD-33-AC3** — Perfil herdado: 10 mil conversas/100 mil mensagens/100 sessões, 10min de aquecimento + 30min de medição x3 em hardware/rede/seed fixos; p95 inbound<250ms/realtime<500ms, inesperados<0.1%, zero perda/duplicação nos cenários determinísticos; EXPLAIN hotpaths e memória/pool/backpressure observados.
- **PROD-33-AC4** — Browser LCP<=2.5s/INP<=200ms/CLS<=0.1 no perfil fixo, JS inicial gzip<=120KiB/CSS<=25KiB; reportar três rodadas e pior resultado. Não confundir laboratório com percentil75 de campo ou disponibilidade mensal.
- **PROD-33-R3-AC1** — Exigir tipos number finitos, linhas inteiras, identidade/SQL/plano, janela temporal, orçamento congelado e calcular aderência do número ao orçamento; negativos isolados para null, string vazia, excedente e futuro.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-33.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

R3-OP01 aberto: gate aceita medições nulas/excedentes/futuras. Não há nova carga real/SLO/SQL medido; manter orçamentos congelados. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
