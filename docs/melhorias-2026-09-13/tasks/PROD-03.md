# PROD-03 — Corrigir agregador e política required PR/release/scheduled

**Observação da auditoria:** Políticas e paginação implementadas; evento desconhecido cai em push, identidade de imagem ainda não liga build/scan/boot. REWORK.

**Tratamento:** REPAIR_AND_VERIFY · REWORK

**Achados:** OPS04, OPS06

**Origem:** CVG-PRODUCTION-20260913 / PROD-03 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P0 · **Marco:** M0 · **Estimativa relativa:** 5

**Dono funcional:** Plataforma/CI · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP02, OP03, OP05, OP16

**Dependências:** [PROD-01](PROD-01.md), [PROD-02](PROD-02.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `.github/scripts/certification-aggregator.mjs`
- `.github/scripts/certification-aggregator.test.mjs`
- `.github/workflows/triple-aaa-certification.yml`
- `.github/workflows/triple-aaa-gate.yml`
- `scripts/production/prod-03.test.mjs`

**Locks:** deploy-ci

## Critérios de aceite

- **PROD-03-AC1** — Inventário requerido cobre Docker/boot, staging real, coverage global, migrations fresh e upgrade distintos, E2E, carga/DR e segurança; jobs agregados não escondem falhas dos dependentes.
- **PROD-03-AC2** — Diferenciar políticas de PR, push/tag de release e scheduled; dependency-review só aplicável em PR não torna push impossível, mas ausência de prova requerida para release nunca vira dispensada silenciosamente.
- **PROD-03-AC3** — Consultar runs/jobs paginados no SHA correto e checar imagem testada; antigo sucesso, cancelamento, job duplicado/renomeado, skip e payload malformado rejeitados conforme política.
- **PROD-03-AC4** — Reproduzir os adversariais da auditoria e demonstrar rejeição; testar todos requeridos verdes e vincular a configuração de branch protection/rulesets inspecionada.
- **PROD-03-R2-AC5** — EVENT fora do enum (incluindo relase) falha com exit não zero; política de dispatch explícita. Provas de imagem devem apontar aos mesmos manifest digests consumidos por scan/boot/E2E e promoção.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-03.test.mjs
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
