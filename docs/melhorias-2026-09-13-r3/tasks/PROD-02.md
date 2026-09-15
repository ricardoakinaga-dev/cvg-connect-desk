# PROD-02 — Corrigir gate mestre e vínculo de evidência ao candidato

**Observação da auditoria:** 27/27 casos passam no candidato R3; gate rejeita métricas inválidas/excedentes/futuras, orçamento divergente, SQL/plano ausente e artefato derivado sem runId/attempt ou com identidade divergente.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS01, OPS02, OPS03, R3-OP01, R3-OP02

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-02 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P0 · **Marco:** M0 · **Estimativa relativa:** 8

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
- **PROD-02-R3-AC1** — Exigir tipos number finitos, linhas inteiras, identidade/SQL/plano, janela temporal, orçamento congelado e calcular aderência do número ao orçamento; negativos isolados para null, string vazia, excedente e futuro.
- **PROD-02-R3-AC2** — Validar run/attempt e vínculo esperado tanto no payload quanto no manifesto derivado; preservar metadados e exigir mesma semântica de identidade/tempo em todas vias.

## Verificação proposta

Estado: **PASS**. Ambiente: Candidato R3; Node v24.20.0; fixture adversarial temporária; runId r3-prod02-20260913-a1; attempt 1.

27/27 casos passam; tipos, orçamento congelado, aderência calculada, SQL/plano, janela temporal e run/attempt são validados.

```bash
node --test scripts/production/prod-02.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

R3-OP01 e R3-OP02 corrigidos no gate: 27/27 casos passam, com contraprovas de tipos/budget/tempo e identidade de run/attempt. Aguardar revisão independente e integração com os produtores reais de artefatos.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-02/r3-prod02-20260913-a1/manifest.json, evidencias/prod-02/r3-prod02-20260913-a1/prod-02.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
