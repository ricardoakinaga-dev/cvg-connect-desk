# Plano de Execucao — Smoke E2E de Send Message com Fixture Estavel

Data: 2026-04-10
Status: Ativo
Escopo: Ampliar a trilha Playwright com o proximo smoke E2E mais valioso sem inflar escopo

## 1. Objetivo

Este plano existe para atacar o proximo passo mais util da trilha E2E:

- adicionar cobertura browser-driven de `send message`;
- criar um fixture estavel de conversa para esse fluxo;
- manter a execucao simples, reproduzivel e barata de manter;
- atualizar a documentacao de testes com o estado real final.

O objetivo nao e construir uma suite completa de chat E2E.
O objetivo e fechar o proximo smoke mais relevante depois de login, inbox, create task e kanban.

## 2. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler:

1. `docs/45-plano-execucao-claude-code-smoke-send-message-fixture-estavel.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/25-plano-testes-completo.md`
4. `docs/19-test-strategy.md`
5. `docs/16-validation-checklist.md`
6. `docs/21-instalacao-local.md`
7. `docs/18-deployment-and-runtime.md`
8. `e2e/README.md`

Regras:

- validar no codigo o estado atual antes de implementar;
- usar `/docs` como fonte da verdade;
- manter o escopo pequeno e operacional;
- nao chamar de pronto algo que ficar apenas scaffoldado.

## 3. Estado Atual Consolidado

O projeto ja possui:

- Playwright configurado no root;
- stack minima de E2E em `e2e/support/start-e2e-stack.ts`;
- smoke tests de login, inbox autenticada, create task e kanban;
- frontend com Inbox, composer e chamada real para `/messages`;
- API com rota real de envio de mensagem.

O proximo gap pratico:

- ainda nao existe smoke browser-driven de envio de mensagem;
- ainda falta um fixture de conversa estavel e reproduzivel para suportar esse fluxo sem fragilidade.

## 4. Objetivo Tecnico da Task

O Claude Code deve executar esta task na seguinte ordem:

1. confirmar o fluxo real de envio no `desk-web`;
2. definir a menor estrategia segura para fixture de conversa;
3. implementar o fixture no bootstrap E2E ou helper equivalente;
4. criar smoke test de `send message`;
5. executar o que for viavel;
6. atualizar a documentacao.

## 5. Escopo Obrigatorio

### Frente A — Revalidar o Fluxo Real

Inspecionar pelo menos:

- `apps/desk-web/src/pages/Inbox.tsx`
- `apps/desk-web/src/lib/api.ts`
- `modules/chat/src/presentation/http/outbound.controller.ts`
- quaisquer endpoints/repositorios necessarios para fixture minima

Confirmar:

- como a conversa e selecionada na Inbox;
- como a mensagem outbound e enviada;
- qual payload o frontend envia;
- qual evidência visual minima pode ser usada no browser para afirmar sucesso.

### Frente B — Fixture Estavel de Conversa

Implementar a menor estrategia confiavel para garantir uma conversa pronta para o smoke.

Exemplos aceitaveis:

- seed de conversa + mensagem no bootstrap E2E;
- helper dedicado em `e2e/support`;
- fixture deterministica criada no banco antes do teste.

A fixture precisa ser:

- reproduzivel;
- idempotente;
- simples de limpar ou reusar;
- independente de interacoes manuais.

O Claude Code deve evitar fixture instavel baseada em dados aleatorios nao controlados pela suite.

### Frente C — Smoke Test de Send Message

Criar um smoke browser-driven cobrindo, no minimo:

1. login real;
2. abrir Inbox com conversa fixture;
3. selecionar a conversa correta;
4. preencher o composer;
5. enviar mensagem;
6. confirmar reflexo minimo do sucesso.

A confirmacao minima pode ser uma combinacao de:

- mensagem aparecendo na UI;
- resposta HTTP coerente refletida na interface;
- ou outro marcador minimo robusto e visivel no browser.

O teste deve ser:

- simples;
- happy path;
- estavel;
- barato de manter.

### Frente D — Documentacao

Ao final, atualizar:

1. `docs/25-plano-testes-completo.md`
2. `docs/GAPS-TECNICOS.md`
3. `docs/19-test-strategy.md`
4. `docs/16-validation-checklist.md`
5. `e2e/README.md`

Se necessario:

6. `docs/21-instalacao-local.md`

Regras:

- documentar o novo smoke apenas se ele realmente existir;
- distinguir claramente fixture criada de teste executado;
- registrar o comando real de execucao.

## 6. Fora de Escopo

Nao abrir nesta task:

- suite completa de chat E2E;
- upload de midia;
- realtime full end-to-end distribuido;
- CI pipeline;
- refatoracao grande do Inbox;
- fixtures sofisticadas demais se um seed simples resolver.

## 7. Arquivos a Inspecionar Primeiro

### E2E

- `playwright.config.ts`
- `e2e/support/start-e2e-stack.ts`
- `e2e/smoke/support.ts`
- `e2e/README.md`

### Frontend

- `apps/desk-web/src/pages/Inbox.tsx`
- `apps/desk-web/src/lib/api.ts`

### API / Chat

- `modules/chat/src/presentation/http/outbound.controller.ts`
- `apps/desk-api/src/app.ts`
- repositorios de `conversation` e `message`, se a fixture precisar deles

## 8. Critérios de Aceite

Esta task so pode ser considerada bem-sucedida se:

1. existir uma fixture estavel de conversa para E2E;
2. existir smoke browser-driven de `send message`;
3. o comando de execucao estiver claro;
4. a documentacao refletir o estado real;
5. o relatorio final diferenciar:
   - fixture criada;
   - teste criado;
   - teste realmente executado.

Se o teste for criado mas nao puder ser executado no ambiente atual, a decisao final deve ser `PARCIAL`.

## 9. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar um relatorio contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. estrategia de fixture escolhida;
4. o que foi implementado;
5. arquivos alterados;
6. como ficou o smoke de `send message`;
7. comandos de execucao;
8. o que foi realmente executado;
9. riscos remanescentes;
10. decisao final:
   - `PRONTO`
   - `PARCIAL`
   - `PENDENTE`

## 10. Instrucao Final

Leia este documento inteiro antes de qualquer alteracao.

Depois:

1. leia os documentos obrigatorios;
2. valide no codigo o fluxo atual de envio;
3. implemente a fixture estavel;
4. escreva o smoke de `send message`;
5. execute o que for viavel;
6. atualize a documentacao;
7. entregue o relatorio final no formato deste plano.
