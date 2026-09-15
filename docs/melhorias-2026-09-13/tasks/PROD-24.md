# PROD-24 — Fechar membership de labels, setores e grupos

**Observação da auditoria:** Aceites deste cartão ainda não encerrados; código existente deve ser revalidado e complementado, sem presumir ausência pela marca PLANNED.

**Tratamento:** IMPLEMENT_AND_VERIFY · REMAINING_SCOPE

**Achados:** FE11

**Origem:** CVG-PRODUCTION-20260913 / PROD-24 / estado recebido PLANNED

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

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-24.spec.ts --config playwright.production.config.ts
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
