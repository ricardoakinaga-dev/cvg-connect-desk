# PROD-02 — Corrigir gate mestre e vínculo de evidência ao candidato

**Observação da auditoria:** 94 testes da frente de gates/runtime passam; três adversariais novos aceitam evidência inválida. REWORK.

**Tratamento:** REPAIR_AND_VERIFY · REWORK

**Achados:** OPS01, OPS02, OPS03

**Origem:** CVG-PRODUCTION-20260913 / PROD-02 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M0 · **Estimativa relativa:** 8

**Dono funcional:** Plataforma + crítico de evidências · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP01, OP07, OP16

**Dependências:** [PROD-00](PROD-00.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `scripts/triple-aaa-verify.mjs`
- `scripts/production/evidence-gate.mjs`
- `scripts/production/prod-02.test.mjs`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-02-AC1** — Rejeitar SHA/lock/source/image digest divergentes, evidência antiga de outro candidato, JSON vazio/truncado, query set vazio e PASS só narrativo; conservar logs da falha.
- **PROD-02-AC2** — FAIL, BLOCKED, NOT_RUN, skipped indevido e gate requerido ausente impedem VERIFIED_CANDIDATE; saída não zero para falha e estado inequívoco para evidência ausente.
- **PROD-02-AC3** — Exigir manifesto por check com comando, ambiente, horário, resultado, hashes e escopo real; não reutilizar percentuais de coverage fixos no texto.
- **PROD-02-AC4** — Caso bom selado aceita; cada caso ruim isoladamente rejeita. Selo AAA não pode ser criado só por status local nem sem política de release definida.
- **PROD-02-R2-AC5** — Reproduzir e rejeitar OPS01–03: alterar só imageDigest esperado deve falhar; command incompatível, exitCode99, log vazio, timestamp futuro, run/attempt ausentes e métricas/coverage sem denominador não podem aprovar. Queries [{}] ou conjunto incompleto devem falhar por schema e orçamento.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-02.test.mjs
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
