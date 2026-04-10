# Plano de Execucao — G-06 Testes Prioritarios

**Documento:** Plano de trabalho para fechar o gap G-06 com testes de comportamento prioritarios
**Data:** 2026-04-10
**Status:** Ativo
**Fonte da verdade:** `/docs`

---

## 1. Objetivo

Este plano existe para orientar o Claude Code a atacar o gap G-06 com foco nos testes que a documentacao do projeto ja define como mais importantes.

O objetivo nao e "aumentar numero de testes" genericamente.
O objetivo e adicionar evidência de comportamento real nas areas que hoje representam maior risco de regressao:

1. inbound idempotente;
2. webhook security;
3. realtime auth behavior;
4. smoke E2E inicial de fluxos criticos.

---

## 2. Fonte da Verdade Obrigatoria

O Claude Code deve ler primeiro:

1. `docs/38-plano-execucao-claude-code-g06-testes-prioritarios.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/11-security-and-access-control.md`
7. `docs/10-realtime-and-events.md`

Regras:

- usar `/docs` como fonte da verdade;
- validar o estado atual no codigo antes de implementar;
- nao apresentar teste estrutural como teste comportamental;
- priorizar o menor conjunto de testes com maior valor de risco.

---

## 3. Estado Atual Consolidado

Com base na documentacao e nas auditorias anteriores:

### 3.1 Ja Existe

- infraestrutura de testes com Vitest;
- suites em `apps`, `packages` e alguns `modules`;
- melhorias recentes no fan-out e no realtime;
- `pnpm test` passa no monorepo.

### 3.2 Gap Real

Segundo `docs/GAPS-TECNICOS.md`, `docs/25-plano-testes-completo.md` e `docs/19-test-strategy.md`, ainda faltam testes prioritarios de comportamento em areas criticas:

- inbound idempotente;
- webhook HMAC/security;
- realtime auth behavior;
- smoke E2E de fluxos principais.

---

## 4. Objetivo Tecnico da Task

O Claude Code deve executar esta task nesta ordem:

1. adicionar testes de idempotencia inbound;
2. adicionar testes de webhook security;
3. adicionar testes de comportamento do realtime auth;
4. se o escopo permitir, iniciar smoke E2E minimo;
5. atualizar a documentacao ao final.

---

## 5. Escopo Obrigatorio

### Frente A — Testes de Idempotencia Inbound

Base documental:

- `docs/19-test-strategy.md`
- `docs/16-validation-checklist.md`
- `docs/25-plano-testes-completo.md`

Caso obrigatorio:

> a mesma mensagem/evento recebida 4 vezes nao pode gerar 4 registros distintos

O teste deve validar, no comportamento:

1. envio repetido do mesmo identificador externo;
2. apenas uma mensagem persistida;
3. sem crash;
4. estado final coerente da conversa.

Prioridade de implementacao:

- usar o fluxo mais real possivel do inbound;
- se nao for possivel testar via rota completa, testar o use case real com persistencia real;
- explicar claramente o nivel de integracao atingido.

### Frente B — Testes de Webhook Security

Base documental:

- `docs/11-security-and-access-control.md`
- `docs/19-test-strategy.md`
- `docs/25-plano-testes-completo.md`

Casos obrigatorios:

1. request sem assinatura/header obrigatorio e rejeitado;
2. assinatura invalida e rejeitada;
3. assinatura valida e aceita;
4. comportamento em producao sem `WEBHOOK_SECRET` e fail-secure.

Objetivo:

- provar o comportamento da borda de seguranca;
- nao apenas verificar que o guard existe.

### Frente C — Testes de Realtime Auth Behavior

Base documental:

- `docs/11-security-and-access-control.md`
- `docs/GAPS-TECNICOS.md`
- docs recentes de realtime hardening

Casos obrigatorios:

1. cliente nao autenticado nao pode subscribe;
2. autenticacao valida libera operacoes;
3. revalidacao periodica falha e encerra conexao;
4. novo fluxo principal de auth (message-based, se ja implementado no cliente) funciona;
5. fallback legado, se ainda existir, deve ser separado e claramente tratado.

Preferencia:

- testes de comportamento reais ou integrados do protocolo;
- evitar apenas `toContain(...)`.

### Frente D — Smoke E2E Inicial

Base documental:

- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`

Objetivo:

Se o escopo e o ambiente permitirem, iniciar o menor smoke E2E util.

Ordem preferencial:

1. login flow;
2. send message;
3. create task.

Se Playwright ainda nao for viavel nesta task:

- registrar claramente o bloqueio;
- deixar a base preparada;
- nao inflar conclusao.

---

## 6. Prioridade de Entrega

Se precisar cortar escopo, manter esta ordem:

1. inbound idempotente
2. webhook security
3. realtime auth behavior
4. smoke E2E

O minimo aceitavel desta task e entregar valor real nas tres primeiras frentes.

---

## 7. Fora de Escopo

Nao faz parte desta task:

- refatorar toda a arquitetura de testes;
- atingir coverage global de 75% sozinho;
- reabrir temas de outbox/fan-out;
- criar suite E2E completa do produto inteiro;
- trocar framework de testes.

---

## 8. Arquivos a Inspecionar Primeiro

### Chat / Inbound

- `modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts`
- testes existentes relacionados a chat/inbound
- repositorios de mensagem e conversa

### Webhook / API

- `packages/shared/src/webhook-guard.ts`
- `apps/desk-api/src/index.ts`
- rotas e testes de webhook existentes

### Realtime

- `apps/realtime-service/src/index.ts`
- `apps/realtime-service/src/__tests__/`
- `apps/desk-web/src/lib/realtime.ts`
- `apps/desk-web/src/__tests__/realtime.test.ts`

### Test Infra

- configs de Vitest;
- qualquer helper de banco/teste no monorepo;
- eventual base Playwright, se existir.

---

## 9. Criterios de Aceite

Esta task so pode ser considerada bem sucedida se:

1. houver novos testes de comportamento em pelo menos idempotencia inbound, webhook security e realtime auth;
2. os testes tiverem sido executados de fato;
3. o relatorio final diferenciar claramente:
   - teste estrutural
   - teste comportamental
   - teste integrado
   - E2E
4. a documentacao for atualizada ao final para refletir o que foi realmente entregue.

Se Playwright nao entrar, isso nao invalida a task, desde que as tres frentes prioritarias avancem de forma real.

---

## 10. Atualizacao Documental Obrigatoria

Ao final, revisar e ajustar:

1. `docs/GAPS-TECNICOS.md`
2. `docs/25-plano-testes-completo.md`

E, se necessario:

3. `docs/19-test-strategy.md`
4. `docs/16-validation-checklist.md`

Regras:

- nao marcar G-06 como resolvido se ainda faltar evidencia relevante;
- registrar exatamente o que foi coberto;
- atualizar prioridade dos proximos passos restantes.

---

## 11. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia de teste adotada;
4. o que foi implementado;
5. arquivos alterados;
6. testes adicionados por frente:
   - inbound idempotente
   - webhook security
   - realtime auth
   - smoke E2E, se houver
7. testes executados;
8. ambiente usado;
9. ajustes feitos na documentacao;
10. riscos remanescentes;
11. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

---

## 12. Instrucao Final

Leia este documento inteiro, depois releia os documentos listados na secao 2, valide o estado atual no codigo e execute a task completa.

Nao entregue apenas analise.

Implemente os testes de comportamento prioritarios, execute-os e atualize a documentacao com honestidade ao final.
