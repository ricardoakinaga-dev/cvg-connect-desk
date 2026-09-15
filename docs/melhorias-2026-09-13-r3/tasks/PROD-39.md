# PROD-39 — Reconciliar documentação e runbooks com o candidato

**Observação da auditoria:** Documentação central reconciliada nesta auditoria. Futuro candidato precisa atualização de estado/aceites/runbooks sem reescrever evidências históricas.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** DOC01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-39 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M5 · **Estimativa relativa:** 5

**Dono funcional:** Documentação técnica + SRE/lead · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE02, OP16, BE01, UI15, DT01

**Dependências:** [PROD-33](PROD-33.md), [PROD-35](PROD-35.md), [PROD-37](PROD-37.md), [PROD-38](PROD-38.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `docs/00-meta/README.md`
- `docs/ARCHITECTURE.md`
- `docs/THREAT_MODEL.md`
- `docs/TEST_MATRIX.md`
- `docs/TRIPLE_AAA_CERTIFICATION.md`
- `docs/18-deployment-and-runtime.md`
- `docs/21-instalacao-local.md`
- `docs/GAPS-TECNICOS.md`
- `docs/design`
- `docs/README.md`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-39-AC1** — Atualizar fotografia do candidato com hashes/contratos/limitações; rotular auditorias antigas como históricas via índice sem alterar o arquivo preservado13/09.
- **PROD-39-AC2** — Remover claims conflitantes in-memory/userId/sem OTel/DB placeholder/nenhum blocker; classificar arquitetura alvo,estado atual,expansão e evidência, sem confundir PLANNED com ausência.
- **PROD-39-AC3** — TEST_MATRIX aponta check+run+imagem+resultado atual+escopo e inclui os 55itens; C01–C10 e decisões ratificadas coerentes com APIs/DTOs/UI e logs.
- **PROD-39-AC4** — Outro operador segue instalação, recuperação, monitoramento, troca de credencial e rollback com dados sintéticos; instruções executadas, não só revisão textual.
- **PROD-39-R2-AC5** — Manter documentação atualizada por tarefa e preservar snapshots. Contratos não podem repetir ausência de worker async, pipeline de mídia, DLQ persistente ou OTel quando já existem; provas antigas não recebem VERIFIED atual sem reexecução.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: revisão documental; operação somente quando autorizada.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Documentação central reconciliada nesta auditoria. Futuro candidato precisa atualização de estado/aceites/runbooks sem reescrever evidências históricas. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
