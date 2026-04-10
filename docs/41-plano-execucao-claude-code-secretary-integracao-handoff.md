# Plano de Execucao — Secretary Integration e Handoff Ponta a Ponta

Data: 2026-04-10
Status: Em revisao
Escopo: Fechar a proxima frente critica de integracao funcional apos a consolidacao da camada HTTP/API

## 1. Objetivo

Executar a proxima rodada de validacao e implementacao com foco em:

- integracao real do `secretary-adapter`;
- fluxo de `handoff` bot -> humano ponta a ponta;
- rastreabilidade operacional do handoff;
- evidencias executadas em testes reais ou integrados;
- reconciliacao documental do que de fato foi entregue.

Este plano existe para que o Claude Code leia este arquivo e execute a tarefa completa, usando a pasta `/docs` como fonte da verdade do projeto.

## 2. Contexto Consolidado

As frentes anteriores ja consolidaram:

- autenticacao forte e hardening principal do realtime;
- pipeline de eventos com outbox persistido e fan-out por consumer;
- integracoes HTTP/API criticas de `auth`, `chat`, `events polling`, `webhook inbound` e `kanban`;
- testes prioritarios de G-06 em idempotencia inbound, webhook security e realtime auth behavior.

O proximo gap mais util para avancar o projeto agora e a comprovacao real de que a integracao com Secretary e o fluxo de handoff funcionam como a documentacao promete.

## 3. Fonte da Verdade Obrigatoria

Antes de qualquer alteracao, o Claude Code deve ler pelo menos estes documentos:

- `docs/GAPS-TECNICOS.md`
- `docs/06-integration-contracts.md`
- `docs/07-backend-architecture.md`
- `docs/10-realtime-and-events.md`
- `docs/11-security-and-access-control.md`
- `docs/12-audit-and-observability.md`
- `docs/19-test-strategy.md`
- `docs/25-plano-testes-completo.md`
- `docs/16-validation-checklist.md`

Se houver divergencia entre relato anterior e codigo atual, o Claude Code deve confiar no codigo validado e registrar essa divergencia no relatorio final.

## 4. Estado Atual Esperado para Revalidacao

O Claude Code deve confirmar no codigo, antes de implementar:

1. que `processMessageWithSecretary()` e chamado no fluxo inbound;
2. que `triggerHandoff()` existe e publica eventos de handoff;
3. que o `secretary-adapter` usa o cliente de integracao em `packages/integrations`;
4. que o `desk-api` inicializa o Secretary client quando configurado;
5. que o `message-worker` possui handlers ou comportamento relacionado a handoff/alerts;
6. que a auditoria e os eventos esperados para handoff estao alinhados com o dominio.

## 5. Objetivo Tecnico da Task

Transformar a integracao com Secretary e o fluxo de handoff em uma area validada com evidencia real, cobrindo pelo menos:

- invocacao da Secretary com contrato correto;
- comportamento quando a Secretary responde com `respond`;
- comportamento quando a Secretary responde com `handoff`;
- publicacao dos eventos de handoff;
- impacto no estado da conversa;
- auditoria minima do handoff;
- robustez quando a Secretary falha ou retorna resposta invalida.

## 6. Escopo Obrigatorio

### 6.1 Secretary Adapter Integration

Criar ou fortalecer testes que validem de forma real:

- construcao do request enviado para Secretary;
- uso de credencial segregada, conforme a documentacao;
- tratamento de timeout, erro HTTP e payload invalido;
- parsing e validacao da resposta da Secretary;
- preservacao de `classification`, `response`, `shouldHandoff` e `handoffReason`.

### 6.2 Fluxo de `processMessageWithSecretary`

Criar testes reais ou integrados que provem:

1. quando a Secretary retorna sucesso sem handoff:
   - a chamada nao quebra o fluxo;
   - `classified = true`;
   - `handoffTriggered = false`;
   - a resposta relevante fica acessivel ao caso de uso.

2. quando a Secretary retorna `handoff` e o handler atual e `bot`:
   - `triggerHandoff()` e executado;
   - os eventos esperados sao publicados;
   - `handoffTriggered = true`.

3. quando a Secretary retorna `handoff` mas a conversa ja esta com handler `human`:
   - o fluxo nao dispara handoff redundante;
   - o comportamento e documentado com precisao.

4. quando a Secretary falha:
   - o inbound nao cai;
   - a falha e tratada como nao critica;
   - o sistema preserva operacao principal.

### 6.3 Fluxo Inbound com Secretary Ponta a Ponta

Criar teste integrado do fluxo inbound cobrindo o maximo seguro possivel, preferencialmente com banco real:

- entrada de mensagem inbound;
- persistencia da mensagem;
- invocacao da Secretary;
- decisao de handoff;
- publicacao dos eventos;
- auditoria do handoff, quando aplicavel;
- estado final coerente da conversa.

Se houver limitacao pratica para cobrir tudo em um unico teste, o Claude Code deve dividir em 2 ou 3 testes integrados complementares e explicar claramente o porquê.

### 6.4 Eventos e Auditabilidade do Handoff

O Claude Code deve validar e, se necessario, corrigir:

- emissao de `handoff.requested`;
- emissao de `handoff.completed`;
- metadata relevante de handoff;
- `correlation_id` e rastreabilidade onde ja houver base para isso;
- registro de auditoria associado ao handoff bot -> human.

## 7. Casos Minimos Obrigatorios

Os testes finais precisam cobrir, no minimo:

1. `invokeSecretary()` com resposta valida de classificacao;
2. `invokeSecretary()` com erro HTTP/timeout;
3. `processMessageWithSecretary()` com resposta sem handoff;
4. `processMessageWithSecretary()` com handoff real;
5. `receiveInboundMessage()` com Secretary acionada e handoff disparado;
6. `receiveInboundMessage()` com falha da Secretary sem derrubar o fluxo;
7. verificacao de eventos `handoff.requested` e `handoff.completed`;
8. verificacao de auditoria do handoff, se o fluxo atual a suportar.

## 8. Estrategia de Teste Esperada

Prioridade de execucao:

1. testes integrados com PostgreSQL real para os fluxos de dominio;
2. mock HTTP local para a Secretary, se necessario;
3. validacao real dos eventos publicados no outbox, quando aplicavel;
4. mocks apenas nos pontos externos estritamente necessarios.

Nao considerar como evidencia suficiente:

- teste apenas estrutural com `toContain(...)`;
- validacao apenas por leitura de arquivo;
- afirmar integracao ponta a ponta sem exercitar o caso de uso real.

## 9. Arquivos Provaveis de Trabalho

O Claude Code deve inspecionar prioritariamente:

- `modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts`
- `modules/chat/src/application/use-cases/process-message-with-secretary.use-case.ts`
- `modules/secretary-adapter/src/application/use-cases/invoke-secretary.use-case.ts`
- `modules/secretary-adapter/src/application/use-cases/trigger-handoff.use-case.ts`
- `modules/secretary-adapter/src/infrastructure/response-handler.ts`
- `packages/integrations/src/secretary-client.ts`
- `packages/events/src/handoff-events.ts`
- `apps/desk-api/src/app.ts`
- `apps/message-worker` nos handlers relacionados a handoff

Arquivos de teste provaveis:

- `modules/secretary-adapter/src/__tests__/...`
- `modules/chat/src/__tests__/...`
- `apps/message-worker/src/__tests__/...`

## 10. Fora de Escopo

Nao abrir nesta task:

- Playwright ou E2E browser;
- refatoracao visual do frontend;
- reescrita ampla de arquitetura;
- mudancas de produto fora do fluxo Secretary/handoff;
- endurecimento de infraestrutura que nao seja necessario para validar este fluxo.

## 11. Ajustes Documentais Obrigatorios

Ao final, o Claude Code deve revisar e atualizar, se necessario:

- `docs/GAPS-TECNICOS.md`
- `docs/25-plano-testes-completo.md`
- `docs/19-test-strategy.md`

Se o resultado mostrar que Secretary/handoff ficou substancialmente validado:

- marcar o gap correspondente como mitigado ou reduzir severidade, com justificativa objetiva.

Se ainda ficar parcial:

- registrar exatamente o que falta;
- nao exagerar a conclusao.

## 12. Criterios de Aceite

Esta task so deve ser considerada bem-sucedida se houver:

1. evidencia executada de integracao com Secretary;
2. evidencia executada de handoff bot -> human;
3. validacao real de eventos de handoff;
4. fluxo resiliente a falha da Secretary;
5. documentacao coerente com o que foi efetivamente executado.

## 13. Entregavel Obrigatorio

Ao final, o Claude Code deve entregar um relatorio completo contendo:

1. documentos consultados;
2. estado atual confirmado no codigo;
3. o que foi implementado ou corrigido;
4. arquivos alterados;
5. testes adicionados;
6. testes executados;
7. ambiente usado;
8. evidencias do fluxo Secretary/handoff;
9. riscos remanescentes;
10. decisao final: `PRONTO`, `PARCIAL` ou `PENDENTE`.

## 14. Decisao Esperada

O objetivo deste plano nao e forcar uma conclusao otimista.

A conclusao final deve ser:

- `PRONTO` apenas se houver evidencia real e suficiente;
- `PARCIAL` se ainda houver dependencias importantes;
- `PENDENTE` se o fluxo nao puder ser validado de forma confiavel.

## 15. Instrucao Final para Execucao

Leia este arquivo por completo antes de alterar qualquer coisa.

Depois:

1. leia os documentos citados;
2. revalide no codigo o estado atual;
3. implemente o que faltar;
4. execute os testes;
5. atualize a documentacao necessaria;
6. entregue o relatorio final no formato definido neste plano.
