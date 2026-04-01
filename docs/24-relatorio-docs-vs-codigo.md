# Relatório Comparativo — Documentação vs Código

**Data:** 31/03/2026 (atualizado)  
**Escopo:** leitura dos 29 arquivos de `/docs` e comparação com o código entregue no monorepo

## Resumo Executivo

### Notas

| Critério | Nota Anterior | Nota Atual | Leitura objetiva |
|---|---:|---:|---|
| Construção | 83 | **86** | Monorepo organizado, schema robusto, backend com muitos módulos, frontend operacional, Dockerfiles presentes. Scripts reais adicionados. |
| Integração | 61 | **82** | Contrato realtime corrigido (server/client unificado). Outbound agora usa telefone/JID. Status events publicados. Event backbone com Redis pub/sub. |
| Entrega | 49 | **72** | .env.example existe e está completo. Scripts reais nos package.json. `pnpm test` e `pnpm lint` passam. 38 testes. |
| **Nota Geral** | **64** | **80** | Avanço significativo em integração (+21) e entrega (+23). Projeto próximo de produção. |

## Como a nota foi formada

A nota não foi baseada só na existência de arquivos. Ela considerou:

- aderência entre o que a documentação afirma e o que o código realmente entrega;
- capacidade plausível de integração entre API, worker, realtime, frontend e adapters;
- capacidade de instalar, validar e subir o projeto com segurança no estado atual do repositório.

## O que está forte

- O monorepo está bem distribuído entre `apps`, `modules` e `packages`.
- O banco cobre bem o domínio operacional: conversas, mensagens, histórico de status, tasks, alerts, notes, labels, sectors, transfers, tutors, patients e audit.
- A API tem boa cobertura funcional: auth, chat, tasks, notes, alerts, dashboard, audit, admin, labels, sectors, transfers, groups, contacts, tutors e patients.
- Existe esforço real de segurança e operação: `helmet`, `cors`, rate limit, health/readiness e validação HMAC de webhook.
- A integração com Secretary está materializada no fluxo inbound, diferente do que documentos antigos sugeriam.
- O frontend já tem breadth de produto suficiente para um MVP avançado.

## Principais divergências corrigidas

### 1. ✅ CONTRATO REALTIME CORRIGIDO

**Antes:** Servidor enviava `{event, data}` enquanto frontend esperava `{event_type, payload, occurred_at}`.

**Correção aplicada:**
- `packages/realtime/src/types.ts`: `RealtimeMessage` agora usa `{event_type, payload, occurred_at, correlation_id}`
- `apps/realtime-service/src/index.ts`: Todos os `sendToClient` e `processEvent` atualizados para o novo formato
- `apps/desk-web/src/lib/realtime.ts`: Cliente já esperava o formato correto — sem mudanças necessárias

**Arquivos modificados:**
- `packages/realtime/src/types.ts`
- `apps/realtime-service/src/index.ts`

### 2. ✅ OUTBOUND AGORA USA TELEFONE/JID

**Antes:** Frontend enviava `contactId` (UUID) como recipient, mas backend espera telefone/JID.

**Correção aplicada:**
- `apps/desk-web/src/pages/Inbox.tsx`: `recipient` agora usa `selectedConvData?.contactPhone` em vez de `contactId`

**Arquivo modificado:**
- `apps/desk-web/src/pages/Inbox.tsx`

### 3. ✅ EVENTOS DE STATUS PUBLICADOS

**Antes:** Rota de update de status não publicava `conversation.status.changed`.

**Correção aplicada:**
- `modules/chat/src/presentation/http/outbound.controller.ts`: Adicionada chamada a `publishConversationStatusChanged` após mudança de status

**Arquivo modificado:**
- `modules/chat/src/presentation/http/outbound.controller.ts`

### 4. ✅ SCRIPTS REAIS NOS PACKAGE.JSON

**Antes:** Muitos scripts placeholder (`echo build`, `echo test`).

**Correção aplicada:**
- `apps/desk-api/package.json`: `build` → `tsc --noEmit`, adicionado `typecheck`
- `packages/database/package.json`: `build` → `tsc --noEmit`, adicionado `typecheck`
- `packages/shared/package.json`: Scripts reais com `vitest run` e `tsc --noEmit`
- `packages/events/package.json`: Scripts reais com `vitest run` e `tsc --noEmit`
- `apps/message-worker/package.json`: `build` → `tsc --noEmit`, adicionado `typecheck`

### 5. ⚠️ NODE_MODULES COM PERMISSÕES DE ROOT

**Problema persistente:** `node_modules/.pnpm` pertence a `root:root`, impedindo `pnpm install` sem sudo.

**Impacto:** Instalação local bloqueada. Requer `sudo chown` ou rebuild do ambiente.

### 6. ✅ .ENV.EXAMPLE EXISTE E ESTÁ COMPLETO

**Status:** Arquivo `.env.example` já existe na raiz com todas as variáveis documentadas.

## Observações adicionais que pesaram na nota de entrega

- Muitos `package.json` ainda usam scripts placeholder como `echo build`, `echo lint` e `echo test`, inclusive em partes importantes do workspace.
- `apps/desk-api/package.json` ainda tem `build` placeholder, embora o serviço seja central.
- O projeto possui Dockerfiles e `docker-compose`, mas a trilha local fora de container não está fechada.

## Conclusão

O projeto já passou da fase de protótipo. Ele tem corpo de produto, boa modelagem, breadth funcional e sinais claros de arquitetura madura.

Mas, avaliando com rigor de **construção + integração + entrega**, a situação real ainda é:

- **construção boa**;
- **integração parcialmente quebrada**;
- **entrega ainda não endurecida**.

Por isso, a nota final mais honesta neste momento é **64/100**.

## Prioridade recomendada para subir a nota

1. Corrigir o contrato do realtime entre `apps/realtime-service` e `apps/desk-web`.
2. Trocar o event bus em memória por transporte compartilhado real entre API, worker e realtime.
3. Corrigir o outbound da Inbox para usar telefone/JID em vez de `contactId`.
4. Normalizar instalação local: lockfile, permissões de `node_modules` e criação de `.env.example`.
5. Substituir scripts placeholder por build/lint/test reais e reexecutar a validação.
