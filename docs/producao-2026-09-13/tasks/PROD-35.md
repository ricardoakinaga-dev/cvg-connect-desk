# PROD-35 — Sanear cadeia de fornecimento e provar todas as imagens

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

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
node --test scripts/production/prod-35.test.mjs
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Revalidar os achados e predecessores desta tarefa no candidato atual, antes de editar.

**Sinal de conclusão da ação:** Mapa achado→caminho real e reprodução/limite atual registrados no retorno.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
