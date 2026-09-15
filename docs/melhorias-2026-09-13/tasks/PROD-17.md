# PROD-17 — Validar sessão inicial e navegação por capacidade

**Observação da auditoria:** 268 testes web atuais e render sintético de bootstrap confirmam avanço; falta browser com API real e revogação integrada.

**Tratamento:** COMPLETE_AND_VERIFY · PARTIAL_REQUIRES_VERIFICATION

**Achados:** Sem achado individual; completar/revalidar os aceites.

**Origem:** CVG-PRODUCTION-20260913 / PROD-17 / estado recebido IMPLEMENTED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 3

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

Estado: **NOT_RUN**. Ambiente: Ambiente sintético próprio; URL/identidade antes de imports. Testes reais usam runner validado e artifacts fora do histórico..

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm --filter @cvg/desk-web test
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Reproduzir o estado observado e os achados deste cartão no candidato congelado; separar correção, complemento e prova pendente.

**Sinal de conclusão da ação:** Reprodução/limites e subtarefas com aceites registrados, sem perder trabalho entregue.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
