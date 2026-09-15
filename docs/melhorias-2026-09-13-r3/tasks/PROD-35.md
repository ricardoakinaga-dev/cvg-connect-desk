# PROD-35 — Sanear cadeia de fornecimento e provar todas as imagens

**Observação da auditoria:** OPS01 corrigido; OPS06 parcial. Vincular manifest digest real por imagem a build/scan/boot/E2E/promoção, mantendo SBOM e gestão de vulnerabilidades.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** OPS01, OPS06

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-35 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M4 · **Estimativa relativa:** 8

**Dono funcional:** Segurança supply chain/plataforma · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** OP04, OP09, DT02

**Dependências:** [PROD-34](PROD-34.md), [PROD-36](PROD-36.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `.github/workflows/security.yml`
- `.github/workflows/ci.yml`
- `package.json`
- `pnpm-lock.yaml`
- `apps/*/Dockerfile`
- `docs/security`
- `scripts/production/prod-35.test.mjs`

**Locks:** deploy-ci, workspace-manifests

## Critérios de aceite

- **PROD-35-AC1** — Audit prod/dev, SAST,secrets,dependencyreview conforme evento,SBOM e Trivy em API/worker/realtime/web e imagens de serviço entregues; scans no mesmo digest usado por boot/smoke/promoção.
- **PROD-35-AC2** — Fixar imagens/actions/runtime conforme política; verificar suporte/compatibilidade com fontes oficiais na execução e testar upgrades, sem trocar versões só por recomendação genérica.
- **PROD-35-AC3** — Zero High/Critical explorável ou não triado; target zero nas imagens. Exceção documentada por vulnerabilidade/alcance/mitigação/dono/prazo só autoridade responsável, nunca justifica falha comprovada de acesso/dados.
- **PROD-35-AC4** — Remover suppressões globais silenciosas e avaliar ignore-unfixed; gerar proveniência/hash assinável verificável, permissões CI mínimas e sem segredos nos artifacts.
- **PROD-35-R2-AC5** — Construir uma vez e publicar imagens por manifest digest; mesmo conjunto deve atravessar scans, boot, E2E e promoção. docker inspect .Id sozinho não encerra identidade de imagem entregue.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
node --test scripts/production/prod-35.test.mjs
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

OPS01 corrigido; OPS06 parcial. Vincular manifest digest real por imagem a build/scan/boot/E2E/promoção, mantendo SBOM e gestão de vulnerabilidades. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
