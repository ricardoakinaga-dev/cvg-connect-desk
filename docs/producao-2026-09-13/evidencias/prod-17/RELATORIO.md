# PROD-17 — Relatório de execução (sessão inicial e navegação por capacidade)

**Tarefa:** PROD-17 (UI01/UI02/UI13/BE03/BE04 · G02/G07 · C01/C02)  
**Data:** 2026-09-13  
**Candidato:** `754f9ba` + worktree de produção; alterações preexistentes preservadas  
**Estado:** IMPLEMENTED; não declaro DONE. Fechamento depende de revisão independente e PROD-40.

## 1. Problema confirmado

- `ProtectedRoute` liberava a árvore protegida somente pela flag persistida
  `isAuthenticated`; `checkAuth` não era chamado no boot de `App`.
- Qualquer erro de `/auth/me` apagava o token, inclusive falha transitória de rede,
  sem uma recuperação distinta de 401/403.
- `Layout` renderizava todos os itens de navegação, inclusive Administração e
  Auditoria, sem consultar as permissões efetivas retornadas por `/auth/me`.
- Não havia tratamento de deep-link sem capacidade.

## 2. Delta implementado

| Caminho | Mudança |
|---|---|
| `apps/desk-web/src/store/auth.ts` | Estado explícito `AuthStatus`; boot inicia em `checking`; `/auth/me` é obrigatório antes de liberar rotas; falha de rede preserva principal/token para retry sem liberar dados; 401 limpa sessão; 403 gera estado distinto; usuário aceita `permissions`, `permissionsAuthoritative` e setores aditivos. |
| `apps/desk-web/src/App.tsx` | `AuthBootstrap` chama `checkAuth` uma vez; guards distinguem loading, erro, sessão inválida e capacidade ausente; rota inicial escolhe o primeiro caminho autorizado; expiração encerra realtime antes de navegar ao login. |
| `apps/desk-web/src/navigation.ts` | Fonte única de grupos/itens do menu e permissões exigidas; visibilidade e rota inicial usam somente `user.permissions`. |
| `apps/desk-web/src/components/layout/Layout.tsx` | Menu filtrado por capacidade; logout desliga realtime e limpa sessão local mesmo se a API falhar. |
| `apps/desk-web/src/index.css` | Estado visual acessível para o bloqueio de autenticação. |
| `apps/desk-web/src/__tests__/production/prod-17.test.tsx` | Provas de boot bloqueado, falha recuperável, menu/deep-link por capacidade e expiração com desconexão realtime. |
| `apps/desk-web/src/__tests__/production/prod-17-auth-store.test.ts` | Provas do store para sucesso, falha de rede preservável e 401 destrutivo. |
| `apps/desk-web/src/components/layout/__tests__/Layout.test.tsx` | Fixture passou a declarar permissões, refletindo o contrato efetivo de `/auth/me`. |

O backend continua sendo a fronteira de autorização; esconder menu ou mostrar o
estado negado não concede acesso a nenhum endpoint.

## 3. Critérios de aceite

### AC1 — boot e estados de sessão — PASS em testes de UI/store

- Rota protegida permanece em `Validando sua sessão…` enquanto `authStatus` é
  `checking`, mesmo com usuário/token persistidos.
- Falha transitória mantém o principal para retry, mas `isAuthenticated` fica
  falso e nenhuma tela protegida é renderizada.
- 401 remove token/principal e exibe aviso de sessão expirada; 403 mantém uma
  mensagem de acesso distinta.

### AC2 — capacidades e deep-link — PASS em testes de UI

- Menus são derivados de `permissions` e Administração/Auditoria exigem
  `admin:read`.
- Deep-link sem a permissão necessária retorna estado acessível `Acesso negado`.
- Usuário sem menu operacional recebe `/settings` como rota inicial, em vez de
  ser redirecionado cegamente para `/inbox`.

### AC3 — expiração/logout/reconexão — PASS parcial, sem browser real

- Expiração confirmada chama `realtimeClient.disconnect`, limpa a sessão e
  navega para `/login`.
- Logout também desliga realtime antes da limpeza local e tolera falha do
  endpoint remoto.
- Rotação externa que torna o token antigo inválido converge pelo 401 confirmado
  da API; não foi criado um fluxo automático de `/auth/rotate` no cliente.

### AC4 — shell mobile e acessibilidade — PASS unitário; browser NOT_RUN

- Skip-link, `inert`, trap de foco, Escape, retorno de foco, botão nomeado e
  estado realtime já existentes permanecem cobertos por `Layout.test.tsx` e
  `ConnectionStatus`.
- Playwright/browser real e inspeção visual em 375/768/1440px não foram
  executados nesta tarefa; não são convertidos em PASS.
- O shell não inventa setores/contadores: só exibiria campos de setor quando
  fornecidos pelo contrato da API.

## 4. Comandos e resultados

| Comando | Exit | Resultado |
|---|---:|---|
| `pnpm --filter @cvg/desk-web typecheck` | 0 | PASS |
| `pnpm --filter @cvg/desk-web exec eslint src/App.tsx src/navigation.ts src/store/auth.ts src/components/layout/Layout.tsx src/__tests__/production/prod-17.test.tsx src/__tests__/production/prod-17-auth-store.test.ts --max-warnings 0` | 0 | PASS |
| `pnpm --filter @cvg/desk-web exec vitest run src/__tests__/production/prod-17.test.tsx src/__tests__/production/prod-17-auth-store.test.ts src/components/layout/__tests__/Layout.test.tsx` | 0 | 11/11 PASS |
| `pnpm --filter @cvg/events exec vitest run src/__tests__/persistent-dead-letter.test.ts` via `run-integration-isolated.mjs --run-id fix-dlq-followup --worker 50` | 0 | 11/11 PASS; correção FK de ator real confirmada |

Uma execução completa da suíte web anterior ao ajuste da fixture de layout teve
259/260 testes PASS; a única falha era a fixture sem `permissions`. O teste foi
corrigido e os três arquivos afetados passaram na execução final acima. A suíte
web completa ainda deve ser repetida após este delta.

## 5. Limitações e recuperação

- A resposta real atual de `/auth/me` fornece permissões, mas não fornece
  explicitamente a lista de setores do usuário; o frontend não presume uma lista
  nem transforma `/sectors` em membership.
- A validação foi unitária/jsdom; browser, API real e WS real permanecem para a
  matriz integrada de PROD-38/PROD-40.
- Rollback: remover `navigation.ts`, os guards/estado de boot e os testes/docs
  PROD-17; restaurar somente a fixture do `Layout.test.tsx`. Nenhum schema ou
  dado foi alterado por PROD-17.
