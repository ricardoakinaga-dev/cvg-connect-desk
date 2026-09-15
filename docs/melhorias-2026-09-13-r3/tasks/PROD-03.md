# PROD-03 — Corrigir agregador e política required PR/release/scheduled

**Observação da auditoria:** 18/18 casos passam no candidato R3; agregador valida run/attempt da imagem contra o workflow selecionado, além de manter políticas por evento, paginação e rejeição dos adversariais.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS04, OPS06, R3-OP02

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-03 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M0 · **Estimativa relativa:** 5

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
- **PROD-03-R3-AC1** — Validar run/attempt e vínculo esperado tanto no payload quanto no manifesto derivado; preservar metadados e exigir mesma semântica de identidade/tempo em todas vias.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3; Node v24.20.0; fixtures fiéis da API GitHub; runId r3-prod03-20260913-a1; attempt 1.

18/18 casos passam; imagem exige digest vinculado ao run/attempt selecionado e eventos/políticas continuam falhando fechado.

```bash
node --test scripts/production/prod-03.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Identidade de imagem agora exige o run/attempt selecionado; 18/18 casos passam e o evento desconhecido continua falhando fechado. Aguardar PROD-01, revisão independente e prova remota de rulesets/digests entregues.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-03/r3-prod03-20260913-a1/manifest.json, evidencias/prod-03/r3-prod03-20260913-a1/prod-03.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
