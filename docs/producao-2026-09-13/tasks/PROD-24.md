# PROD-24 — Fechar membership de labels, setores e grupos

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 5

**Dono funcional:** Frontend cadastros + backend catálogos · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI11, UI12, UI02, BE04

**Dependências:** [PROD-04](PROD-04.md), [PROD-17](PROD-17.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/pages/Labels.tsx`
- `apps/desk-web/src/pages/Sectors.tsx`
- `apps/desk-web/src/pages/ContactGroups.tsx`
- `apps/desk-web/src/pages/Contacts.tsx`
- `apps/desk-web/src/lib/api.ts`
- `modules/labels/src`
- `modules/sectors/src`
- `modules/contact-groups/src`
- `e2e/production/prod-24.spec.ts`

**Locks:** web-contract-inbox

## Critérios de aceite

- **PROD-24-AC1** — Adicionar/remover contato em grupos e labels via UI/API existente; instruções de tela apontam para ações que existem, e persistência aparece após reload.
- **PROD-24-AC2** — Editar setor/grupo e ativar/desativar respeita permissões, labels de sistema protegidas e vínculos referenciados; nomes e erros de conflito claros.
- **PROD-24-AC3** — Mudança de membership/escopo dispara invalidação de listas e corta acesso anterior; filtros e contadores correspondem a dados reais autorizados.
- **PROD-24-AC4** — Negativos outra identidade/setor, duplicidade e referência removida; ações recuperáveis no teclado/mobile com confirmação apropriada.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm exec playwright test e2e/production/prod-24.spec.ts --config playwright.production.config.ts
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
