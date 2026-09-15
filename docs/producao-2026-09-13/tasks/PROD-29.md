# PROD-29 — Fechar responsividade e acessibilidade em toda a aplicação

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
- `docs/producao-2026-09-13/evidencias`
- `e2e/production/prod-29.spec.ts`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-29-AC1** — Corrigir drawer fechado do Inbox: não amplia scrollWidth nem participa foco/árvore acessível; em 1024 viewport sem largura 1318; abrir/Escape restaura foco.
- **PROD-29-AC2** — Matriz todas as 16 rotas + shell/redirecionamento/deep-link em 375x812,390x844,768x1024,1024x768,1440x900 e em torno de 860/1260; normal cinco viewports e estados adicionais desktop+menor aplicável.
- **PROD-29-AC3** — WCAG2.2AA aplicável: teclado, leitor de tela real, foco, contraste, status announcements, zoom 200%/reflow, reduced-motion incluindo JS, orientação/teclado virtual/safe areas; zero barreira essencial/Critical/High não tratado.
- **PROD-29-AC4** — Capturas nativas e console/rede/hash por fixture/estado; críticos independentes julgam sem justificar score por código. Sem leitor de tela disponível é NOT_RUN, não skip aprovado nem alegação AAA.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm exec playwright test e2e/production/prod-29.spec.ts --config playwright.production.config.ts
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
