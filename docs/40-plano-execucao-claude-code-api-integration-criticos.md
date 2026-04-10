# Plano de Execucao — API Integration Criticos

**Documento:** Plano de trabalho para consolidar testes de integracao nas rotas criticas
**Data:** 2026-04-10
**Status:** Ativo
**Fonte da verdade:** `/docs`

---

## 1. Objetivo

Este plano existe para continuar avancando o projeto com foco em **testes de integracao de API** nas rotas mais sensiveis do sistema.

Depois dos avancos em:

- fan-out por consumer;
- hardening do realtime;
- testes de idempotencia inbound;
- testes de webhook security;
- testes de auth realtime behavior;

o proximo passo de maior valor e validar a camada HTTP/rotas de forma integrada.

O objetivo desta task e reduzir o risco de regressao na fronteira da API, sem depender ainda de E2E browser completo.

---

## 2. Fonte da Verdade Obrigatoria

O Claude Code deve ler primeiro:

1. `docs/40-plano-execucao-claude-code-api-integration-criticos.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/11-security-and-access-control.md`
7. `docs/10-realtime-and-events.md`
8. `docs/18-deployment-and-runtime.md`

Regras:

- `/docs` e a fonte da verdade;
- validar no codigo o estado atual antes de implementar;
- diferenciar claramente teste unitario, comportamental, integracao de rota e E2E;
- priorizar rotas criticas de negocio e seguranca.

---

## 3. Estado Atual Consolidado

Com base na documentacao e nas auditorias anteriores:

- o projeto ja possui boa base de testes locais/comportamentais;
- G-06 ainda esta parcial;
- a documentacao de testes aponta explicitamente que a **Camada 4: API Integration Tests** continua pendente em varios pontos;
- a estrategia minima de testes tambem reforca a importancia de validar a borda Fastify e nao apenas services/guards isolados.

Segundo `docs/25-plano-testes-completo.md`, a proxima consolidacao relevante e:

- `auth-routes`
- `chat-routes`
- `webhook`
- `events-polling`
- opcionalmente `kanban-routes`

---

## 4. Objetivo Tecnico da Task

O Claude Code deve executar esta task nesta ordem:

1. identificar o que ja existe em testes de rota;
2. implementar testes de integracao para as rotas criticas ainda faltantes;
3. executar o maior subconjunto viavel com ambiente realista;
4. atualizar a documentacao ao final.

---

## 5. Escopo Obrigatorio

### Frente A — Webhook Inbound Integration

Prioridade alta.

Base documental:

- `docs/11-security-and-access-control.md`
- `docs/19-test-strategy.md`
- `docs/25-plano-testes-completo.md`

Casos minimos:

1. request sem assinatura e rejeitado no endpoint real;
2. request com assinatura invalida e rejeitado;
3. request valida passa pela rota e chega ao fluxo esperado;
4. producao sem `WEBHOOK_SECRET` falha de forma segura;
5. request invalida nao contamina o pipeline.

Objetivo:

- sair do teste apenas no guard isolado e validar a fronteira Fastify.

### Frente B — Events Polling Integration

Prioridade alta.

Base documental:

- `docs/10-realtime-and-events.md`
- docs recentes de outbox/fan-out

Casos minimos:

1. `/events` responde no contrato esperado;
2. eventos persistidos podem ser lidos pelo endpoint;
3. `since` e `limit` funcionam corretamente;
4. o comportamento do consumer `http-poll` e consistente com a implementacao atual.

Objetivo:

- validar a borda HTTP do pipeline de eventos, nao apenas o reader interno.

### Frente C — Chat/API Integration Critica

Prioridade media-alta.

Casos minimos:

1. endpoint(s) de mensagem/chat aceitam payload valido;
2. erro de validacao e retornado corretamente para input invalido;
3. fluxo principal de persistencia via rota nao quebra;
4. quando aplicavel, idempotencia ou deduplicacao documentada fica preservada.

Objetivo:

- garantir que a camada HTTP de chat esteja coerente com os use cases ja testados.

### Frente D — Auth Routes Integration

Prioridade media.

Casos minimos:

1. login valido retorna sessao/token conforme implementacao atual;
2. login invalido falha corretamente;
3. `/auth/me` responde corretamente para sessao/token valido;
4. `/auth/me` falha corretamente para token invalido/ausente.

Objetivo:

- consolidar a confianca na mesma fronteira usada pelo realtime-service.

### Frente E — Kanban Routes Integration

Prioridade opcional dentro desta task.

Se houver tempo/ambiente:

1. mover card por rota real;
2. validar status final;
3. validar erro em transicao invalida, se houver.

Nao e obrigatorio para considerar esta task bem sucedida.

---

## 6. Prioridade de Entrega

Se for necessario cortar escopo, manter esta ordem:

1. webhook inbound integration
2. events polling integration
3. auth routes integration
4. chat routes integration
5. kanban routes integration

O minimo aceitavel desta task e entregar progresso real nas tres primeiras frentes.

---

## 7. Fora de Escopo

Nao faz parte desta task:

- smoke browser Playwright completo;
- refatoracao grande da API;
- reabrir arquitetura de eventos;
- trocar framework de testes;
- implementar cobertura de todos os modulos do sistema.

---

## 8. Arquivos a Inspecionar Primeiro

### API

- `apps/desk-api/src/index.ts`
- `apps/desk-api/src/__tests__/`

### Webhook / Security

- `packages/shared/src/webhook-guard.ts`
- rotas de inbound/chat relacionadas

### Chat

- controllers/use cases usados pela API
- testes ja existentes em `modules/chat`

### Auth

- rotas e handlers de auth
- `packages/auth`

### Events

- `packages/events`
- endpoint `/events`
- implementacao consumer-aware atual

---

## 9. Estrategia de Ambiente

O Claude Code deve escolher o menor ambiente realista e repetivel possivel.

Preferencia:

1. Fastify real em teste/integracao;
2. PostgreSQL real ou ambiente de teste equivalente, quando a rota depender de persistencia real;
3. mocks apenas para dependencias externas estritamente necessarias.

Regras:

- se nao for possivel rodar determinada rota com ambiente real, explicar claramente;
- nao inflar conclusao com teste parcialmente simulado sendo vendido como integracao plena.

---

## 10. Criterios de Aceite

Esta task so pode ser considerada bem sucedida se:

1. existirem novos testes de integracao de rota nas areas criticas;
2. os testes tiverem sido executados de fato;
3. o relatorio final deixar claro o que foi realmente integrado;
4. a documentacao refletir o novo estado de G-06.

Se apenas parte das rotas forem cobertas, a task ainda pode ser valida, desde que isso seja documentado com honestidade.

---

## 11. Atualizacao Documental Obrigatoria

Ao final, revisar e ajustar:

1. `docs/GAPS-TECNICOS.md`
2. `docs/25-plano-testes-completo.md`

E, se necessario:

3. `docs/19-test-strategy.md`
4. `docs/16-validation-checklist.md`

Regras:

- registrar quais frentes de integracao de API passaram a ter cobertura real;
- nao marcar G-06 como resolvido se E2E/Playwright e outros pontos relevantes ainda faltarem;
- atualizar proximos passos remanescentes com precisao.

---

## 12. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia de teste adotada;
4. o que foi implementado;
5. arquivos alterados;
6. testes adicionados por frente:
   - webhook inbound integration
   - events polling integration
   - auth routes integration
   - chat routes integration
   - kanban routes integration, se houver
7. testes executados;
8. ambiente usado;
9. ajustes feitos na documentacao;
10. riscos remanescentes;
11. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

---

## 13. Instrucao Final

Leia este documento inteiro, depois releia os documentos listados na secao 2, valide o estado atual no codigo e execute a task completa.

Nao entregue apenas analise.

Implemente testes de integracao reais nas rotas criticas, execute o que for viavel e atualize a documentacao com honestidade ao final.
