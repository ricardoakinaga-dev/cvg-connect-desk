# PROD-08 — Eliminar conversas órfãs e duplicatas no primeiro inbound

**Estado:** IMPLEMENTED · **Prioridade:** P0 · **Marco:** M1 · **Estimativa relativa:** 8

**Dono funcional:** Backend persistência · **Risco:** R3 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** BE08, BE17, DT01

**Dependências:** [PROD-07](PROD-07.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts`
- `modules/chat/src/infrastructure/repositories/message.repository.ts`
- `modules/chat/src/infrastructure/repositories/inbound-contact.repository.ts`
- `modules/chat/src/__tests__`
- `apps/desk-api/src/__tests__/production/prod-08.test.ts`

**Locks:** Aplicar exclusão por arquivos e recursos do ambiente.

## Critérios de aceite

- **PROD-08-AC1** — Duas primeiras mensagens duplicadas concorrentes com/sem externalConversationId produzem uma conversa lógica, mensagem e intenções esperadas; transação perdedora não comita conversa/outbox órfãos.
- **PROD-08-AC2** — Mensagem+estado+contato/vínculo+histórico+outbox participam do executor correto; falha em cada escrita rollback completo e hints somente pós-commit.
- **PROD-08-AC3** — Paginação/keyset preserva ordem total em timestamps empatados e inserts concorrentes; busca/detalhe continuam autorizados.
- **PROD-08-AC4** — Identificar órfãos legados por dry-run e oferecer reconciliação idempotente com aprovação para mutação irreversível, sem apagar silenciosamente mensagens.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Especificação de regressão a criar/adaptar após descoberta. Cobrir os aceites aplicáveis com casos positivos e negativos; exit 0 isolado não comprova o aceite integrado.

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-08.test.ts
```

Criar/adaptar a suíte após descoberta. Incluir execução real, revisão ou observação manual exigida pelos aceites; um runner unitário não substitui PG, browser, provider, scanner ou operador quando requeridos.

## Próxima ação

Corrida da primeira conversa corrigida com advisory lock e rollback; 19/19. Aguarda revisao.

**Sinal de conclusão da ação:** Critico reproduz corrida sem orfaos e reconciliacao dry-run idempotente.

## Recuperação

Trabalhar em branch/worktree própria, preservar alterações preexistentes. Reverter só o delta da tarefa se compatível; em schema/dados preferir expand/contract e roll-forward ensaiado. Teardown apenas por runId e marcador isolado; nunca apagar banco existente.

## Evidência e fechamento

Evidências: evidencias/prod-08/RELATORIO.md, evidencias/prod-08/PROCEDIMENTO-RECUPERACAO.md

Aplicar [critérios](../CRITERIOS.md) e [protocolo do agente](../AGENTE.md). Integrador registra cada aceite, identidade do candidato, revisão e resultado antes de DONE.
