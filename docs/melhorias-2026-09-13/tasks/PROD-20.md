# PROD-20 — Corrigir timeline, anexos e recuperação de envio

**Observação da auditoria:** Aceites deste cartão ainda não encerrados; código existente deve ser revalidado e complementado, sem presumir ausência pela marca PLANNED.

**Tratamento:** IMPLEMENT_AND_VERIFY · REMAINING_SCOPE

**Achados:** FE04, FE05, FE06

**Origem:** CVG-PRODUCTION-20260913 / PROD-20 / estado recebido PLANNED

**Estado:** PLANNED · **Prioridade:** P1 · **Marco:** M2 · **Estimativa relativa:** 8

**Dono funcional:** Frontend conversa/mídia · **Risco:** R2 · **Classe:** PRE_RELEASE_OBRIGATORIO

**Itens auditados:** UI03, UI04, UI16, BE10, BE15

**Dependências:** [PROD-19](PROD-19.md), [PROD-15](PROD-15.md)

**Decisões:** Sem decisão externa específica; verificar contratos e ambiente.

## Escopo de escrita

Caminhos relativos à raiz do repositório; confirmar existência e fronteira antes da edição.

- `apps/desk-web/src/features/inbox`
- `apps/desk-web/src/pages/Inbox.tsx`
- `apps/desk-web/src/lib/api.ts`
- `apps/desk-web/src/lib/realtime.ts`
- `e2e/production/prod-20.spec.ts`

**Locks:** web-contract-inbox

## Critérios de aceite

- **PROD-20-AC1** — Agrupar datas pelo timestamp/timezone real (Hoje apenas data atual), empates/ordem/replay deduplicados, histórico incremental sem pular leitura e sem estourar memória.
- **PROD-20-AC2** — Imagem/áudio/vídeo/documento asset:// resolvem leitura/download autorizado; pending/infected/expirado/revogado não vira URL insegura nem chip sem ação inexplicável.
- **PROD-20-AC3** — Preservar intenção idempotente e rascunho por conversa sob 401/offline/timeout/resposta tardia, cancelar upload e retry; UI distingue recebido pelo provider de entregue.
- **PROD-20-AC4** — RNG do teste backoff determinístico, sem diminuir backoff/jitter produtivo; validar reconexão em browser WSS remoto e teclado/toque de composer/anexos.

## Verificação proposta

Estado: **TO_CREATE**. Ambiente: synthetic-isolated.

Reexecutar/adaptar no candidato novo, cobrindo todos os aceites e negativos. Resultado histórico não fecha tarefa; comando proposto precisa de ambiente e precondições inspecionados.

```bash
pnpm exec playwright test e2e/production/prod-20.spec.ts --config playwright.production.config.ts
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
