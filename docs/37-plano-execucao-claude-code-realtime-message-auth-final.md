# Plano de Execucao — Realtime Message-Based Auth Final

**Documento:** Plano de trabalho para fechar o hardening do token no realtime
**Data:** 2026-04-10
**Status:** Ativo
**Fonte da verdade:** `/docs`

---

## 1. Objetivo

Este plano existe para concluir o hardening do canal realtime no ponto que ainda permanece parcial:

- o servidor ja suporta autenticacao por mensagem;
- o frontend principal ainda usa token na URL;
- os testes ainda nao provam o comportamento runtime completo desse novo fluxo.

O objetivo desta task e:

1. atualizar o `desk-web` para usar autenticacao por mensagem com token;
2. remover o uso padrao de token na URL;
3. adicionar testes de comportamento reais do fluxo realtime;
4. atualizar a documentacao final com o estado verdadeiro.

---

## 2. Fonte da Verdade Obrigatoria

O Claude Code deve ler primeiro:

1. `docs/37-plano-execucao-claude-code-realtime-message-auth-final.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/11-security-and-access-control.md`
4. `docs/10-realtime-and-events.md`
5. `docs/12-audit-and-observability.md`
6. `docs/29-relatorio-final-autenticacao-realtime.md`
7. `docs/36-relatorio-final-realtime-hardening.md`

Regras:

- validar o estado atual no codigo antes de alterar;
- nao assumir que o servidor estar pronto significa que o fluxo completo esta pronto;
- tratar `desk-web + realtime-service + testes + docs` como um pacote unico nesta task.

---

## 3. Estado Atual Consolidado

### 3.1 Ja Confirmado

- o `realtime-service` suporta autenticacao por mensagem em `case 'auth'`;
- o `realtime-service` ainda suporta token na URL por compatibilidade;
- a revalidacao periodica foi implementada no servidor;
- `docs/GAPS-TECNICOS.md` ja reflete:
  - G-02 mitigado;
  - G-03 parcial.

### 3.2 Gap Real Remanescente

O cliente principal ainda usa:

- URL com `?token=<jwt>`;
- `sendAuth()` sem enviar token;

o que significa que:

- o fluxo endurecido existe no backend;
- mas nao e o fluxo padrao do cliente real.

Portanto, G-03 continua parcial ate que o `desk-web` adote o novo fluxo e isso seja testado de verdade.

---

## 4. Objetivo Tecnico da Task

O Claude Code deve executar, nesta ordem:

1. migrar `apps/desk-web/src/lib/realtime.ts` para autenticacao por mensagem com token;
2. parar de usar token na URL como caminho padrao;
3. manter compatibilidade segura apenas se estritamente necessario;
4. adicionar testes de comportamento do fluxo completo;
5. atualizar a documentacao final.

---

## 5. Escopo Obrigatorio

### Frente A — Atualizar o Cliente `desk-web`

O cliente realtime deve:

- abrir o WebSocket sem anexar token na URL por padrao;
- enviar o token no payload da mensagem de auth;
- nao depender de `userId` para autenticacao real;
- continuar permitindo subscribe/resubscribe apos autenticacao;
- manter comportamento de reconnect consistente.

Objetivo:

- o token nao deve mais aparecer na URL como caminho principal de uso.

### Frente B — Compatibilidade e Transicao

O Claude Code deve decidir o menor caminho seguro entre:

1. remover o uso de token na URL do cliente e manter suporte legado apenas no servidor;
2. manter fallback opcional claramente documentado;
3. se remover o fallback do cliente, ajustar logs/mensagens para refletir o novo fluxo.

Regras:

- nao quebrar desnecessariamente o fluxo atual da aplicacao;
- se mantiver compatibilidade, deixar isso explicito e limitado;
- documentar claramente a estrategia adotada.

### Frente C — Testes de Comportamento Reais

Adicionar testes que provem o novo fluxo runtime, nao apenas estrutura.

Casos minimos obrigatorios:

1. cliente conecta sem token na URL e autentica via mensagem com token;
2. autenticacao por mensagem valida libera subscribe;
3. autenticacao ausente ou invalida continua bloqueando subscribe;
4. reconnect continua funcionando com o fluxo novo;
5. se houver fallback legado, ele deve ser testado explicitamente e separado do fluxo principal.

Preferencia:

- testes de comportamento do client `apps/desk-web/src/lib/realtime.ts`;
- testes de integracao com `realtime-service` quando viavel;
- se usar mock de WebSocket, ele deve validar o protocolo real da troca de mensagens, nao apenas presença de strings.

### Frente D — Documentacao

Ao final, atualizar:

1. `docs/GAPS-TECNICOS.md`
2. `docs/36-relatorio-final-realtime-hardening.md`

E, se necessario:

3. `docs/29-relatorio-final-autenticacao-realtime.md`
4. `docs/18-deployment-and-runtime.md`

Regras:

- se o `desk-web` passar a usar message-based auth e isso estiver testado, atualizar G-03;
- se ainda restar fallback legado, descrever isso honestamente;
- nao marcar como `PRONTO` sem evidência real do fluxo cliente-servidor ou do protocolo do cliente.

---

## 6. Fora de Escopo

Nao faz parte desta task:

- redesenhar completamente o protocolo realtime;
- reabrir o tema de outbox/fan-out;
- criar arquitetura de refresh token completa;
- alterar o sistema inteiro de auth do backend;
- criar E2E browser completos se um teste de integracao mais direto resolver o objetivo.

---

## 7. Arquivos a Inspecionar Primeiro

### Cliente

- `apps/desk-web/src/lib/realtime.ts`
- `apps/desk-web/src/__tests__/realtime.test.ts`

### Servidor

- `apps/realtime-service/src/index.ts`
- `apps/realtime-service/src/__tests__/realtime-auth.test.ts`
- `apps/realtime-service/src/__tests__/realtime-revalidation.test.ts`

### Documentacao

- `docs/GAPS-TECNICOS.md`
- `docs/36-relatorio-final-realtime-hardening.md`

---

## 8. Criterios de Aceite

Esta task so pode ser considerada concluida com `PRONTO` se:

1. o `desk-web` deixar de usar token na URL como fluxo padrao;
2. o token passar a ser enviado no fluxo de auth por mensagem;
3. houver testes de comportamento reais sustentando esse fluxo;
4. G-03 puder ser atualizado com evidência real;
5. a documentacao final ficar coerente com o estado do codigo.

Se o servidor continuar apenas "suportando" o novo fluxo, mas o cliente principal nao o usar, o status deve permanecer `PARCIAL`.

---

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. arquitetura escolhida para o fluxo novo;
4. o que foi implementado;
5. arquivos alterados;
6. como ficou o fluxo do `desk-web`;
7. como ficou a compatibilidade legado/novo;
8. testes adicionados/executados;
9. ajustes feitos na documentacao;
10. riscos remanescentes;
11. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

---

## 10. Instrucao Final

Leia este documento inteiro, depois releia os documentos listados na secao 2, valide o estado atual no codigo e execute a task completa.

Nao entregue apenas analise.

Implemente o fluxo novo no cliente, teste o comportamento real e atualize a documentacao ao final.
