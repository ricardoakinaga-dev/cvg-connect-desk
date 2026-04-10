# E2E Smoke Tests — CVG Connect Desk

Smoke tests browser-driven para os fluxos críticos do desk-web.

## Setup

### 1. Instale dependências

```bash
pnpm install
```

### 2. Instale o browser do Playwright

```bash
pnpm exec playwright install chromium
```

### 3. Suba a infra base

O smoke mínimo usa uma stack dedicada em `docker-compose.smoke.yml` para PostgreSQL e Redis. O runner lê `.env` automaticamente via `dotenv/config`, então `pnpm test:e2e` funciona sem `source .env` manual, desde que o arquivo exista na raiz do repositório. Redis é opcional para o app, mas o smoke stack inclui os dois serviços para reduzir ambiguidade operacional.

Comandos da stack:

```bash
pnpm e2e:stack:up
pnpm e2e:stack:down
pnpm e2e:stack:logs
```

### 4. Execute os smoke tests

```bash
pnpm test:e2e
pnpm test:e2e:smoke
```

`pnpm test:e2e` executa os smoke browser-driven usando a infraestrutura disponível no ambiente.
`pnpm test:e2e:smoke` é o caminho padronizado para a stack reproduzível do time e CI local: usa PostgreSQL em `localhost:55432`, Redis em `localhost:56379`, sobe API/realtime/web em portas isoladas e executa os fluxos browser-driven.

Por trás disso, o Playwright usa `webServer` para executar `pnpm exec tsx e2e/support/start-e2e-stack.ts`, que sobe a API em `4330`, realtime em `4930` e o web em `4173`.

Comandos úteis:

```bash
pnpm test:e2e:ui
pnpm test:e2e:smoke
pnpm exec playwright test e2e/smoke/login-flow.test.ts
pnpm exec playwright test e2e/smoke/inbox-authenticated.test.ts
pnpm exec playwright test e2e/smoke/create-task.test.ts
pnpm exec playwright test e2e/smoke/kanban.test.ts
pnpm exec playwright test e2e/smoke/send-message.test.ts
```

## Fluxos cobertos

- Login
- Inbox autenticada
- Criação de tarefa
- Kanban abrindo e renderizando o board
- Envio de mensagem (send message)

## Credenciais

Os smoke usam o usuário bootstrapado no setup mínimo:

- `admin@cvg.com`
- `admin123`

## Estrutura

```
e2e/
└── smoke/
    ├── login-flow.test.ts
    ├── inbox-authenticated.test.ts
    ├── create-task.test.ts
    ├── kanban.test.ts
    ├── send-message.test.ts
    └── support.ts
```

## Fixture de Conversa

O smoke de `send-message` requer uma conversa com contato. O `support.ts` exporta `ensureE2EConversation()` que:

1. Cria (ou reutiliza) um contato `+5511988880011` no banco
2. Cria (ou reutiliza) uma conversa ativa vinculada a esse contato
3. Adiciona uma mensagem inbound para a conversa ter conteúdo

Essa fixture é chamada automaticamente no `beforeAll` do `send-message.test.ts` e é idempotente (pode ser executada múltiplas vezes sem duplicar dados).

## Variáveis relevantes

| Variável | Default | Descrição |
|----------|---------|-------------|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:4173` | URL do frontend usada como base dos testes |
| `DATABASE_URL` | `postgresql://connect_desk:root@localhost:55432/connect_desk_db` | Banco usado pelo setup e pela API no smoke stack |
| `REDIS_URL` | `redis://localhost:56379` | Redis usado pelo smoke stack |
| `VITE_API_URL` | `http://localhost:4330` | URL da API usada pelo smoke |
| `VITE_REALTIME_URL` | `ws://localhost:4930` | URL realtime usada pelo Inbox |

## Observações

- Os testes usam Chromium real via Playwright.
- A stack mínima é iniciada por `e2e/support/start-e2e-stack.ts`.
- A infraestrutura mínima e reproduzível do time fica em `docker-compose.smoke.yml`.
- O smoke cobre só os fluxos críticos e baratos de manter.
- CI: `.github/workflows/smoke-e2e.yml` automatiza `pnpm test:e2e:smoke` em push e PR.
