# Plano de Execucao — Realtime Hardening

**Documento:** Plano de trabalho para revalidacao periodica e hardening do token no realtime
**Data:** 2026-04-10
**Status:** Ativo
**Fonte da verdade:** `/docs`

---

## 1. Objetivo

Este plano existe para orientar o Claude Code a executar o proximo bloco de hardening do projeto no canal realtime.

De acordo com a documentacao oficial e com as auditorias anteriores, o realtime ja possui autenticacao inicial forte, mas ainda restam dois gaps relevantes:

1. ausencia de revalidacao periodica de token em sessoes longas;
2. exposicao do token na URL do WebSocket.

O objetivo desta task e reduzir esses dois riscos de forma incremental, segura e aderente ao projeto.

---

## 2. Fonte da Verdade Obrigatoria

O Claude Code deve ler primeiro:

1. `docs/35-plano-execucao-claude-code-realtime-hardening.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/11-security-and-access-control.md`
4. `docs/10-realtime-and-events.md`
5. `docs/12-audit-and-observability.md`
6. `docs/18-deployment-and-runtime.md`
7. `docs/29-relatorio-final-autenticacao-realtime.md`

Regras:

- validar o estado atual no codigo antes de alterar;
- nao assumir que relatórios antigos substituem a verificacao no codigo;
- se houver conflito entre implementacao atual e doc historico, registrar isso no relatorio final.

---

## 3. Estado Atual Consolidado

Com base na documentacao e no codigo auditado:

### 3.1 Ja Implementado

- o `realtime-service` valida o token no handshake chamando `/auth/me`;
- o `userId` efetivo vem da resposta da API, nao do payload do cliente;
- operacoes de subscribe/unsubscribe exigem autenticacao;
- clientes sem autenticacao sao bloqueados;
- broadcast e restrito a clientes autenticados.

### 3.2 Gaps Reais Remanescentes

#### G-02 — Revalidacao Periodica

Hoje a validacao ocorre apenas na abertura da conexao.
Se a sessao for revogada enquanto a conexao estiver aberta, a conexao continua ativa ate desconexao.

#### G-03 — Token na URL

Hoje o frontend monta `ws://.../?token=<jwt>` e o servidor extrai o token da query string.
Isso aumenta risco de exposicao em logs, proxies e historicos de URL.

---

## 4. Objetivo Tecnico da Task

O Claude Code deve implementar o maior avanço seguro possivel nesta ordem:

1. adicionar revalidacao periodica de autenticacao no `realtime-service`;
2. reduzir ou eliminar o uso do token em query string;
3. adicionar testes reais de comportamento para esses fluxos;
4. atualizar a documentacao ao final.

---

## 5. Escopo Obrigatorio

### Frente A — Revalidacao Periodica de Token

Implementar mecanismo de revalidacao para conexoes longas.

Requisitos minimos:

- o servidor deve revalidar periodicamente a sessao/token do cliente autenticado;
- se a validacao falhar, a conexao deve ser encerrada de forma controlada;
- a falha deve ser observavel por log estruturado;
- o mecanismo nao deve quebrar conexoes autenticadas validas.

Direcao preferencial:

- usar o mesmo endpoint `/auth/me` ou mecanismo equivalente ja adotado;
- tornar o intervalo configuravel por env, por exemplo:
  - `REALTIME_AUTH_REVALIDATE_MS`
- permitir desabilitar explicitamente em desenvolvimento, se necessario, mas documentar isso.

### Frente B — Hardening do Transporte do Token

Reduzir o acoplamento ao token na URL.

O Claude Code deve avaliar e implementar a melhor opcao segura e viavel no escopo atual.

Opcoes aceitaveis:

1. migrar para autenticacao inicial por mensagem logo apos a conexao, sem token na URL;
2. manter compatibilidade temporaria com query string, mas priorizar um fluxo mais seguro;
3. implementar transicao suportando modo legado e modo novo, desde que documentado.

Requisitos:

- nao confiar em `userId` do cliente;
- o token nao deve ficar permanentemente exposto em logs do client/server;
- manter compatibilidade razoavel com o frontend atual ou atualizar o frontend junto;
- registrar trade-offs no relatorio final.

### Frente C — Testes

Adicionar testes cobrindo o comportamento novo.

Casos minimos obrigatorios:

1. conexao autenticada continua valida apos pelo menos uma revalidacao bem-sucedida;
2. conexao e encerrada quando a revalidacao falha;
3. subscribe/unsubscribe continuam bloqueados para cliente nao autenticado;
4. novo fluxo de envio de token (sem query string, se implementado) funciona corretamente;
5. fallback/compatibilidade, se existir, e explicitamente testado.

Prioridade:

- testes de comportamento do `realtime-service`;
- se possivel, testes integrados com o client `apps/desk-web/src/lib/realtime.ts`.

### Frente D — Documentacao

Ao final, atualizar:

1. `docs/GAPS-TECNICOS.md`
2. `docs/29-relatorio-final-autenticacao-realtime.md`

E, se necessario:

3. `docs/11-security-and-access-control.md`
4. `docs/18-deployment-and-runtime.md`

Regras:

- se a revalidacao periodica for implementada e testada, atualizar G-02;
- se o token na URL for mitigado ou removido, atualizar G-03;
- nao marcar como `PRONTO` sem evidência real executada.

---

## 6. Fora de Escopo

Nao faz parte desta task:

- redesign completo do protocolo realtime;
- introducao de OAuth ou outro sistema novo de auth;
- refatoracao ampla de auth do backend inteiro;
- mudancas em eventos/outbox que nao sejam necessarias para este tema;
- criacao de E2E browser completos, salvo se for o menor caminho seguro.

---

## 7. Arquivos a Inspecionar Primeiro

### Backend Realtime

- `apps/realtime-service/src/index.ts`
- `apps/realtime-service/src/__tests__/realtime-auth.test.ts`
- `apps/realtime-service/src/__tests__/realtime-structure.test.ts`

### Frontend Client

- `apps/desk-web/src/lib/realtime.ts`
- `apps/desk-web/src/__tests__/realtime.test.ts`

### Auth / Sessao

- `packages/auth`
- `packages/database/src/schema.ts`
- qualquer uso de `/auth/me` e sessao ativa

---

## 8. Criterios de Aceite

Esta task so pode ser considerada bem sucedida se:

1. houver revalidacao periodica implementada ou uma justificativa tecnica muito forte para alternativa equivalente;
2. houver reducao concreta do risco de token na URL, ou plano de transicao implementado e documentado;
3. os testes cobrirem o novo comportamento;
4. a documentacao ficar alinhada com o estado real;
5. a conclusao final estiver sustentada por execucao real, nao apenas por leitura estrutural.

---

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. arquitetura escolhida para hardening;
4. o que foi implementado;
5. arquivos alterados;
6. como ficou a revalidacao periodica;
7. como ficou o fluxo de token no handshake/conexao;
8. testes adicionados/executados;
9. ajustes feitos na documentacao;
10. riscos remanescentes;
11. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

---

## 10. Instrucao Final

Leia este documento inteiro, depois releia os documentos listados na secao 2, valide no codigo o estado atual e execute a task completa.

Nao entregue apenas analise.

Implemente, teste, documente e entregue um relatorio final honesto.
