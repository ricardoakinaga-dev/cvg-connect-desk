# Plano de Execucao — Hardening Final do Fan-Out e Prontidao de CI

**Documento:** Plano de endurecimento final do fan-out por consumer
**Data:** 2026-04-10
**Status:** Ativo
**Fonte da verdade:** `/docs`

---

## 1. Objetivo

Este plano existe para fechar os pontos residuais apos a validacao com a classe real do `ConsumerAwareOutboxReader`.

O tema principal do fan-out por consumer ja avancou muito e possui evidência real. O foco desta nova etapa nao e reabrir a arquitetura, e sim:

1. eliminar inconsistencias residuais em comentarios e testes;
2. tornar a suite de testes mais sustentavel;
3. reduzir dependencia de hacks locais;
4. preparar o terreno para execucao mais previsivel em CI e em outros ambientes.

---

## 2. Estado Atual Auditado

Com base no relatorio `docs/33-relatorio-final-fanout-classe-real.md` e na auditoria do codigo:

### 2.1 Confirmado

- `outbox-reader-real.test.ts` existe e instancia `ConsumerAwareOutboxReader` diretamente.
- `acknowledge()` foi corrigido para `onConflictDoUpdate`.
- `acknowledgeWithError()` faz UPSERT com `processedAt = NULL`.
- o pacote `events` agora possui testes reais contra PostgreSQL via Docker.

### 2.2 Pontos Residuais Reais

Ainda existem problemas de qualidade e manutencao:

1. `packages/events/src/__tests__/outbox-behavioral.test.ts` continua com expectativa desatualizada de `onConflictDoNothing`.
2. `packages/events/src/outbox-reader.ts` ainda possui comentario desatualizado dizendo que `acknowledge()` usa `onConflictDoNothing`.
3. os testes reais dependem de `docker exec` shell-based, o que funciona, mas nao e a forma mais limpa ou portavel de validar o comportamento.
4. o relatorio 33 menciona correcao manual de `schema.d.ts`, o que sinaliza um problema de geracao/distribuicao de tipos no workspace.

---

## 3. Fonte da Verdade Obrigatoria

O Claude Code deve ler primeiro:

1. `docs/34-plano-execucao-claude-code-fanout-hardening-e-ci.md`
2. `docs/33-relatorio-final-fanout-classe-real.md`
3. `docs/32-plano-execucao-claude-code-fanout-fechamento-final.md`
4. `docs/GAPS-TECNICOS.md`
5. `docs/10-realtime-and-events.md`
6. `docs/12-audit-and-observability.md`

Regras:

- validar tudo no codigo antes de concluir;
- nao inflar conclusao;
- diferenciar claramente "validacao funcional" de "prontidao de manutencao e CI".

---

## 4. Escopo Obrigatorio

### Frente A — Limpeza de Inconsistencias

Corrigir testes, comentarios e docs que ainda descrevem comportamento antigo.

### Frente B — Sustentabilidade da Suite

Melhorar a base dos testes reais para reduzir fragilidade operacional e dependencia de passos manuais.

### Frente C — Prontidao de CI/Workspace

Resolver o problema de tipos/artefatos que exigiu correcao manual de `schema.d.ts`, ou pelo menos documentar e automatizar corretamente esse processo.

---

## 5. Itens Obrigatorios

### 5.1 Corrigir Inconsistencias de Testes e Comentarios

Revisar e alinhar:

- `packages/events/src/__tests__/outbox-behavioral.test.ts`
- `packages/events/src/outbox-reader.ts`

Objetivo:

- nenhum teste estrutural deve afirmar `onConflictDoNothing` se a implementacao real usa `onConflictDoUpdate`;
- nenhum comentario deve descrever comportamento antigo.

### 5.2 Revisar a Estrategia dos Testes Reais

Avaliar e implementar o maior endurecimento seguro possivel para:

- reduzir duplicacao de `execSQL/querySQL/cleanTestData`;
- criar helper compartilhado de banco de teste, se fizer sentido;
- deixar os testes mais legiveis e menos acoplados a shell inline;
- manter a validacao real contra persistencia.

Se for apropriado, criar utilitario de teste em vez de repetir helpers por arquivo.

### 5.3 Tratar o Problema de Tipos do Workspace

Investigar por que o relatorio 33 precisou de ajuste manual de `schema.d.ts`.

Objetivo:

- identificar se o problema esta em build, export, linked package ou geracao de tipos;
- implementar a menor correcao segura para que o workspace reflita corretamente `outboxConsumerAcks`;
- se nao for viavel corrigir totalmente agora, documentar claramente e automatizar o workaround minimamente.

### 5.4 Preparar Execucao Mais Limpa para CI

Sem abrir uma grande infra, o Claude Code deve propor e, se possivel, implementar o maior avanço seguro para facilitar CI, por exemplo:

- detectar e pular testes reais se Docker/Postgres nao estiver disponivel, com mensagem clara;
- separar suite "integration-real-db" da suite estrutural;
- adicionar script/documentacao para execucao consistente.

Importante:

- nao enfraquecer a evidência real;
- nao trocar teste real por mock.

---

## 6. Fora de Escopo

Nao faz parte desta task:

- trocar PostgreSQL por outra estrategia;
- reabrir arquitetura de eventos;
- refatorar worker/realtime sem necessidade;
- mexer em frontend;
- inventar pipeline CI completo se isso exigir grande escopo.

---

## 7. Arquivos a Inspecionar Primeiro

- `packages/events/src/outbox-reader.ts`
- `packages/events/src/__tests__/outbox-reader-real.test.ts`
- `packages/events/src/__tests__/outbox-fanout-behavioral.test.ts`
- `packages/events/src/__tests__/outbox-behavioral.test.ts`
- `packages/events/src/__tests__/schema-check.test.ts`
- `packages/database/src/schema.ts`
- `packages/database/package.json`
- `packages/database/tsconfig.json`
- `packages/events/package.json`
- `pnpm-workspace.yaml`
- `docs/GAPS-TECNICOS.md`

---

## 8. Criterios de Aceite

Esta task so pode ser considerada bem sucedida se:

1. nao restarem testes ou comentarios afirmando comportamento obsoleto;
2. a suite de testes reais ficar mais clara e sustentavel;
3. o problema de tipos do workspace for resolvido ou claramente saneado;
4. existir um caminho mais limpo para execucao local/CI dos testes reais;
5. a documentacao final refletir o novo estado com honestidade.

---

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar:

1. documentos consultados;
2. problemas reais encontrados;
3. o que foi corrigido;
4. arquivos alterados;
5. como a suite de testes ficou organizada;
6. como ficou a questao de tipos do workspace;
7. testes executados;
8. o que ficou mais preparado para CI;
9. riscos remanescentes;
10. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

---

## 10. Instrucao Final

Leia este documento inteiro, depois releia os docs citados na secao 3, valide no codigo o estado atual e execute a task completa.

Nao entregue apenas analise.

Corrija inconsistencias, endureca a suite, saneie o problema de tipos e atualize a documentacao ao final.
