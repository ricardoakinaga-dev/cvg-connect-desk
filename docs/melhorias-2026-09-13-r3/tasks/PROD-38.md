# PROD-38 — Validar percurso completo com serviços reais isolados

**Observação da auditoria:** FE17/OPS06 abertos: somente harness production específico, sem percurso completo real observado. Renderer com mocks não fecha E2E nem identidade de imagem.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS06, FE17

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-38 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M4 · **Estimativa relativa:** 13

**Dono funcional:** QA integração full stack · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI17, OP05, BE06, BE10, BE15, BE20

**Dependências:** [PROD-19](PROD-19.md), [PROD-20](PROD-20.md), [PROD-21](PROD-21.md), [PROD-22](PROD-22.md), [PROD-23](PROD-23.md), [PROD-24](PROD-24.md), [PROD-25](PROD-25.md), [PROD-26](PROD-26.md), [PROD-27](PROD-27.md), [PROD-29](PROD-29.md), [PROD-30](PROD-30.md), [PROD-32](PROD-32.md), [PROD-34](PROD-34.md), [PROD-35](PROD-35.md), [PROD-37](PROD-37.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `e2e/production`
- `e2e/smoke`
- `e2e/aaa/system.spec.ts`
- `playwright.production.config.ts`
- `.github/workflows/smoke-e2e.yml`
- `e2e/production/prod-38.spec.ts`

**Locks:** deploy-ci

## Critérios de aceite

- **PROD-38-AC1** — Atualizar seletores acessíveis do smoke (emojis/placeholders antigos removidos), fixtures estáveis e outputs coerentes; nenhum servidor preexistente reaproveitado sem identidade.
- **PROD-38-AC2** — Login→inbound→atribuição→resposta/anexo→realtime→handoff/transferência→notas/tarefas/alertas→auditoria/privacidade pelo browser, com PG/Redis/MinIO/ClamAV/Collector reais e providers sandbox identificados.
- **PROD-38-AC3** — Dois operadores/setores, sessão expirada,401/403,redelivery,rede offline,crash,restart,scanner falho e callback tardio não vazam/perdem/duplicam efeitos; UI/DB/eventos conferidos conjuntamente.
- **PROD-38-AC4** — Suites obrigatórias sem skip: ambiente ausente reprova/blocked, não verde; execução por imagem/digest do candidato e evidência source hash/run script/trace/logs/resultados completa.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-38.spec.ts --config playwright.production.config.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

FE17/OPS06 abertos: somente harness production específico, sem percurso completo real observado. Renderer com mocks não fecha E2E nem identidade de imagem. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
