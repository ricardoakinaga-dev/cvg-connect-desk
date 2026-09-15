# PROD-03 — Corrigir agregador e política required PR/release/scheduled

**Estado:** IMPLEMENTED · **Prioridade:** P0 · **Marco:** M0 · **Estimativa relativa:** 8

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

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
node --test scripts/production/prod-03.test.mjs
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Agregador corrigido e 16 testes verdes; limitacao GitHub real registrada.

**Sinal de conclusão da ação:** Critico reproduz politicas por evento e rejeicoes.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-03/RELATORIO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
