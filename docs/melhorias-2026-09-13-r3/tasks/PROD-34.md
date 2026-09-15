# PROD-34 — Integrar regressões e coverage efetiva no CI

**Observação da auditoria:** Tipos33/33,lint33/33,web268 e realtime87 passam. R3-RT01 prova lacuna de teste de entrypoint; build/coverage/CI remoto completos não executados.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS02, R3-RT01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-34 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M3 · **Estimativa relativa:** 8

**Dono funcional:** QA/CI · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP03, OP07, DT02, UI17

**Dependências:** [PROD-03](PROD-03.md), [PROD-05](PROD-05.md), [PROD-08](PROD-08.md), [PROD-12](PROD-12.md), [PROD-15](PROD-15.md), [PROD-16](PROD-16.md), [PROD-18](PROD-18.md), [PROD-28](PROD-28.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `.github/workflows/ci.yml`
- `.github/workflows/postgres-real-tests.yml`
- `.github/workflows/smoke-e2e.yml`
- `package.json`
- `turbo.json`
- `eslint.config.js`
- `apps/*/vitest.config.ts`
- `packages/*/vitest.config.ts`
- `modules/*/vitest.config.ts`
- `scripts/production/prod-34.test.mjs`

**Locks:** deploy-ci, workspace-manifests

## Critérios de aceite

- **PROD-34-AC1** — Reintroduzir todos arquivos AAA excluídos usando ambiente/guards do candidato, portáveis por run, sem remover testes protetores; incluir novas production suites e job agregado required.
- **PROD-34-AC2** — Lint/typecheck/build reais abrangem scripts operacionais (incluindo staging-smoke) e packages, lock imutável; reprovação não mascarada por echo,pipe,|| true ou cache de outro candidato.
- **PROD-34-AC3** — Coverage por escopo/branches no código tocado + inventário de fronteiras: manter shared85/80/85/85 e reconciliar doc25 core90/domain80/API70/web60/global75 antes de execução; definir denominadores e eventuais referências divergentes com justificativa, não reduzir por falha.
- **PROD-34-AC4** — Casos conhecidos ruins de autorização/ACK/scan/gate são rejeitados (testes de mutação focados); sem .only e skip requerido; artifacts completos mesmo falha, paths de report/trace coerentes.
- **PROD-34-R2-AC5** — Integrações devem configurar DATABASE_URL isolada antes de importar singleton db; comando direto não pode cair em .env/banco padrão. Guard bloqueia antes de conexão fora do run. Corrigir exclusões AAA e classificar falha de harness separadamente de falha do produto.
- **PROD-34-R3-AC1** — Incluir no CI regressão de bootstrap nativo por subprocesso fora do carregamento Vitest, com logs/exit e matriz HTTP. Regressão falha no candidato R3 e passa após PROD44. Este aceite não depende da qualificação posterior de imagens em PROD35/36.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-34.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Tipos33/33,lint33/33,web268 e realtime87 passam. R3-RT01 prova lacuna de teste de entrypoint; build/coverage/CI remoto completos não executados. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
