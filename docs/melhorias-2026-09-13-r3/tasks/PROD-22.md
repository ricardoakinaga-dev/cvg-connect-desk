# PROD-22 — Tornar notas contextuais e navegáveis

**Observação da auditoria:** FE08/09 OPEN: notas exigem ID e ficha consulta só primeira conversa. Seletores/autorização/agregação/paginação e origem precisam integração.

**Tratamento:** PRESERVE_COMPLETE_AND_VERIFY · AUDITED_R3_NOT_TASK_CERTIFICATION

**Achados:** FE08, FE09

**Origem:** CVG-IMPROVEMENTS-20260913-R2 / PROD-22 / estado recebido PLANNED

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

Estado: **NOT_RUN**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-22.spec.ts --config playwright.production.config.ts
```

Estado: **TO_CREATE**. Ambiente: Candidato R3 próprio; identidade/portas/recursos declarados antes de imports; terceiros somente sandbox autorizado..

Provar os aceites R3 e preservar regressões resolvidas. Logs de auditoria são baseline; cada aceite real exige ferramenta/ambiente apropriado, revisão e evidência nova.

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

FE08/09 OPEN: notas exigem ID e ficha consulta só primeira conversa. Seletores/autorização/agregação/paginação e origem precisam integração. Registrar subtarefas de correção e prova conforme aceites, preservando o comportamento já correto.

**Sinal de conclusão da ação:** Aceites cobertos por evidência atual e revisão; pendências externas registradas sem PASS implícito.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: Ainda não produzidas para esta execução.

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
