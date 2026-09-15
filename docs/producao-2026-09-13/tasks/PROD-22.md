# PROD-22 — Tornar notas contextuais e navegáveis

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 5

**Dono funcional:** Frontend contexto + notes · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI07, UI12, BE05

**Dependências:** [PROD-18](PROD-18.md), [PROD-17](PROD-17.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/pages/Notes.tsx`
- `apps/desk-web/src/pages/Contacts.tsx`
- `apps/desk-web/src/lib/api.ts`
- `modules/notes/src`
- `e2e/production/prod-22.spec.ts`

**Locks:** web-contract-inbox

## Critérios de aceite

- **PROD-22-AC1** — Substituir ID digitado por pesquisa/seletor autorizado de conversa/tarefa/tutor/paciente, com referências humanas e links; criação contextual seleciona entidade correta.
- **PROD-22-AC2** — Autoria vem do principal; impedir authorId falsificado e referência conflitante, com erro acessível e sem salvar parcialmente.
- **PROD-22-AC3** — Detalhe do contato agrega notas de todas conversas autorizadas, não só primeira, com paginação e procedência; sem expor nota de outra entidade/setor.
- **PROD-22-AC4** — Editar/recarregar formulário, erro/retry, vazio e conteúdo longo operáveis em mobile/teclado; retorno do navegador preserva contexto.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm exec playwright test e2e/production/prod-22.spec.ts --config playwright.production.config.ts
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
