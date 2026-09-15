# PROD-17 — Validar sessão inicial e navegação por capacidade

**Observação da auditoria:** Suíte R3 de PROD-17 executada em segmento próprio r3-prod17-20260914-a1; testes web de auth/capacidades passaram em jsdom. Browser/API integrado, revisão independente e gates externos permanecem pendentes.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-17 / estado recebido PLANNED

**Estado:** REVIEW · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 3

**Dono funcional:** Frontend sessão/shell · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI01, UI02, UI13, BE03, BE04

**Dependências:** [PROD-04](PROD-04.md), [PROD-05](PROD-05.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/App.tsx`
- `apps/desk-web/src/store/auth.ts`
- `apps/desk-web/src/components/layout`
- `apps/desk-web/src/pages/Login.tsx`
- `apps/desk-web/src/lib/api.ts`
- `apps/desk-web/src/__tests__/production/prod-17.test.tsx`

**Locks:** web-contract-inbox

## Critérios de aceite

- **PROD-17-AC1** — Boot valida sessão persistida antes de liberar dados/rotas; loading, rede indisponível,401 e403 distintos; sem loop de redirects, estado antigo ou perda indevida de rascunho.
- **PROD-17-AC2** — Menus/rotas administrativos visíveis conforme capacidades efetivas sem confiar na UI para autorização; tentativa deep-link proibida recebe tratamento acessível e backend nega.
- **PROD-17-AC3** — Logout/expiração/rotação desconectam/reautenticam WS e limpam caches sensíveis; principal/setor mudou não herda dados da sessão anterior.
- **PROD-17-AC4** — Shell mobile, skip-link, trap/inert/Escape/retorno foco e conectividade real preservados, labels de setor/contadores derivados de API quando exibidos.

## Verificação proposta

Estado: **PASS**. Ambiente: Vitest/jsdom do pacote desk-web, com React Testing Library e mocks explícitos de auth/realtime; sem API externa ou dados de produção..

22 arquivos e 268 testes passam sem skip; boot antes de /auth/me, erro de rede/401, capacidades/deep-link, logout/expiração/realtime, rota inicial e estado persistido permanecem observáveis; validação browser/API integrada continua pendente.

```bash
CVG_PROGRAM_DIR=/home/ricardo/cvg-connect-desk/docs/melhorias-2026-09-13-r3 CVG_EVIDENCE_SEGMENT=r3-prod17-20260914-a1 AAA_RUN_ID=r3-prod17-20260914-a1 AAA_ATTEMPT=1 pnpm --filter @cvg/desk-web test
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Suíte web R3 executada em Vitest/jsdom; 22 arquivos e 268 testes passaram cobrindo boot seguro, erros de sessão, capacidades/deep-link, expiração/realtime, rota inicial, estado persistido e regressões web. Browser/API integrado e revisão independente permanecem pendentes.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-17/r3-prod17-20260914-a1/manifest.json, evidencias/prod-17/r3-prod17-20260914-a1/prod-17.test.log

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
