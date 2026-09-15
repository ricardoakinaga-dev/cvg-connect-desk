# PROD-29 — Fechar responsividade e acessibilidade em toda a aplicação

**Observação da auditoria:** FE01 OPEN: viewport1024 produz scrollWidth1318 e Tab alcança drawer fechado. Fechamento da matriz visual/a11y continua pendente, embora Escape do drawer aberto funcione.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** FE01

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-29 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M3 · **Estimativa relativa:** 8

**Dono funcional:** Frontend acessibilidade + QA visual · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI16, UI15, UI02, UI03

**Dependências:** [PROD-28](PROD-28.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src`
- `e2e/production`
- `docs/design`
- `docs/melhorias-2026-09-13-r3/evidencias`
- `e2e/production/prod-29.spec.ts`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-29-AC1** — Corrigir drawer fechado do Inbox: não amplia scrollWidth nem participa foco/árvore acessível; em 1024 viewport sem largura 1318; abrir/Escape restaura foco.
- **PROD-29-AC2** — Matriz todas as 16 rotas + shell/redirecionamento/deep-link em 375x812,390x844,768x1024,1024x768,1440x900 e em torno de 860/1260; normal cinco viewports e estados adicionais desktop+menor aplicável.
- **PROD-29-AC3** — WCAG2.2AA aplicável: teclado, leitor de tela real, foco, contraste, status announcements, zoom 200%/reflow, reduced-motion incluindo JS, orientação/teclado virtual/safe areas; zero barreira essencial/Critical/High não tratado.
- **PROD-29-AC4** — Capturas nativas e console/rede/hash por fixture/estado; críticos independentes julgam sem justificar score por código. Sem leitor de tela disponível é NOT_RUN, não skip aprovado nem alegação AAA.
- **PROD-29-R2-AC5** — Reproduzir captura atual Inbox1024 scrollWidth1318; drawer fechado fora do foco/árvore e sem ampliar viewport. Não usar screenshot com mock para encerrar integração ou leitor de tela.

## Verificação proposta

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-29.spec.ts --config playwright.production.config.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

FE01 OPEN: viewport1024 produz scrollWidth1318 e Tab alcança drawer fechado. Fechamento da matriz visual/a11y continua pendente, embora Escape do drawer aberto funcione. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
