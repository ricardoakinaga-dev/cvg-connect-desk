# Relatório de Auditoria Atual — CVG Connect Desk

**Data da auditoria:** 2026-08-12  
**Status:** fonte de verdade do estado auditado em 2026-08-12  
**Baseline executivo:** 74/100  
**Meta de recuperação:** 95/100 em todos os itens analisados  
**Documentos relacionados:** 92-plano-executivo-95-todos-itens.md, 93-roadmap-95-todos-itens.md e 94-backlog-95-todos-itens.md

> Este documento substitui, para fins de decisão, as conclusões otimistas dos relatórios históricos de 98/100. As notas abaixo representam a working tree atual, não apenas o último commit.

## 1. Escopo e método

Foram revisados:

- os 106 arquivos Markdown de docs/, totalizando aproximadamente 27.545 linhas;
- apps, módulos, packages, migrations, Dockerfiles, Compose, scripts e manifests;
- testes unitários, estruturais, de integração, cobertura, segurança de sessão e auditoria de dependências;
- o comportamento disponível no ambiente atual, distinguindo execução real, cache, skip e bloqueio de infraestrutura.

O working tree estava com muitas alterações locais preexistentes. Nenhuma correção de código foi implementada como parte desta auditoria. A avaliação foi feita sobre o estado encontrado em 2026-08-12.

## 2. Resumo executivo

O produto está substancialmente construído: há API Fastify, frontend operacional, inbox/chat, tarefas, notas, alertas, dashboard, autenticação, RBAC, auditoria, gateway, Secretary/handoff, contatos, Kanban, eventos, outbox, worker e realtime.

O principal problema não é falta de superfície funcional. É confiabilidade de produção. Há riscos de segurança no gateway, armazenamento/exposição inadequada de sessão, bugs potenciais em autorização, dead-letter não persistente, dependências vulneráveis, testes reais que podem ser ignorados quando o PostgreSQL não está disponível e imagens Docker que mascaram erros de compilação.

Decisão: o sistema está em estado de MVP avançado/pré-produção. Não deve ser declarado pronto para exposição externa antes do fechamento dos itens P0 do backlog 94.

## 3. Evidências executadas

| Verificação | Resultado | Leitura |
|---|---|---|
| Build | PASS em 27/27 pacotes | A cadeia de build do workspace executa. |
| Lint | PASS em 27/27 pacotes | Não substitui revisão de warnings e segurança. |
| Typecheck padrão | PASS em 27/27 | O wrapper é relaxado e exclui vários testes; não prova compilação estrita. |
| Typecheck estrito do desk-api | FAIL | Há erros de tipos em runtime, handlers Fastify e testes. |
| Testes sem cache | 26/27 pacotes PASS; desk-api FAIL | O desk-api teve 14 arquivos falhos, 9 testes falhos e 78 ignorados; PostgreSQL recusou conexão em 127.0.0.1:5432. |
| Eventos sem banco | 125 PASS, 24 SKIPPED | Outbox real e schema check não foram comprovados nesta máquina. |
| Coverage crítico | FAIL | desk-web ficou em 79,08% de statements, abaixo do gate de 80%. |
| Security session check | PASS | O fluxo web não persiste token em storage e não usa Bearer no caminho principal. |
| pnpm audit | FAIL | 4 vulnerabilidades low, 34 moderate, 42 high e 2 critical foram reportadas. |
| Playwright/E2E | NÃO EXECUTADO | A porta 55432 da stack E2E estava ocupada por outro container. |

O teste completo anteriormente executado com Turbo cache não é tratado como prova suficiente. A execução sem cache foi necessária e evidenciou a dependência real de PostgreSQL e os skips.

## 4. O que está construído

| Área | Estado observado |
|---|---|
| API e domínio | API modular com autenticação, chat, tarefas, notas, alertas, dashboard, admin, auditoria e módulos premium. |
| Frontend | Rotas e telas para login, inbox, contatos, Kanban, tarefas, notas, alertas, setores, labels, grupos, dashboard, admin, auditoria e settings. |
| Chat e inbound | Recepção inbound, persistência de conversas/mensagens, idempotência por identificador externo e publicação de eventos. |
| Outbound/gateway | Serviços de envio de texto e mídia, status/receipts e endpoints de integração. |
| Secretary | Cliente HTTP, classificação/handoff e eventos de transição bot/humano. |
| Eventos | Envelopes versionados, outbox PostgreSQL, polling e consumer acknowledgements. |
| Worker | Retry, processamento de eventos e encaminhamento para dead-letter. |
| Realtime | WebSocket com autenticação por cookie, revalidação e projeção de eventos. |
| Dados | Schema Drizzle/PostgreSQL amplo e migrations até outbox, acknowledgements e versionamento. |
| Operação | Docker Compose, health/readiness, métricas, logs estruturados, Swagger e scripts de QA. |

## 5. Scorecard atual

As notas são julgamentos de maturidade baseados em implementação, evidência e risco residual. Não são percentuais automáticos de cobertura.

| Item analisado | Nota atual | Nota alvo | Gap | Diagnóstico resumido |
|---|---:|---:|---:|---|
| Documentação e rastreabilidade | 55 | 95 | 40 | Volume alto, mas mistura estado atual, alvo e histórico; há claims de 98/100 contraditas pelos gates atuais. |
| Escopo funcional construído | 84 | 95 | 11 | MVP amplo e implementado; falta transformar comportamento em evidência repetível. |
| Arquitetura e monorepo | 86 | 95 | 9 | Boa modularidade; typecheck estrito, dependências globais e alguns acoplamentos reduzem confiança. |
| Banco de dados e migrations | 82 | 95 | 13 | Schema forte e outbox real; tokens brutos, seed permissivo e DLQ fora do banco. |
| Backend/API | 79 | 95 | 16 | Muitos endpoints; validação, autorização de integrações e tipagem estrita ainda insuficientes. |
| Chat, webhook e idempotência | 80 | 95 | 15 | HMAC e idempotência existem; testes reais não foram comprovados e erros SQL podem virar resposta externa. |
| Secretary e handoff | 86 | 95 | 9 | Fluxo implementado e testado; dependência externa e métricas precisam de contratos operacionais. |
| Tarefas, notas e alertas | 83 | 95 | 12 | CRUD, UI e testes existem; faltam cobertura de integração e autorização de ponta a ponta. |
| Premium, Kanban e contatos | 75 | 95 | 20 | Módulos existem, mas Kanban/gateway têm poucos testes e há autorização incompleta no movimento de cards. |
| Autenticação, RBAC e sessões | 78 | 95 | 17 | Cookie/CSRF/RBAC presentes; token cru no banco/JSON e bugs de condição exigem correção. |
| Segurança geral | 62 | 95 | 33 | Gateway sem proteção clara, supply chain vulnerável, CSP/trust proxy e rate limit com riscos residuais. |
| Outbox, worker e realtime | 86 | 95 | 9 | Pipeline forte; dead-letter volátil e timer do worker pode sobrepor execuções. |
| Frontend | 80 | 95 | 15 | Produto navegável e build real; coverage e fluxos E2E ainda insuficientes. |
| Dashboard e KPIs | 74 | 95 | 21 | Endpoints existem, mas D1/D2 ainda usam semântica simplificada para mensagens humanas/handoff. |
| Auditoria e observabilidade | 72 | 95 | 23 | Logs/métricas/health existem; dead-letter e counters são locais ao processo e não há operação completa de produção. |
| Testes, QA e CI | 60 | 95 | 35 | Testes unitários bons, porém integração real falha/é ignorada, E2E não foi provado e coverage falha. |
| Dependências e supply chain | 38 | 95 | 57 | Auditoria atual falha com vulnerabilidades high e critical. |
| Deploy e runtime | 72 | 95 | 23 | Compose/Docker existem; Docker mascara tsc, healthcheck do worker é frágil e configuração de produção tem arestas. |

**Nota geral:** 74/100. A nota geral não é a média simples: segurança, supply chain e testes têm peso de bloqueio para qualquer decisão de produção.

## 6. Principais bloqueadores

### P0 — segurança e exposição

1. **Gateway sem autenticação/autorização uniforme.** As rotas de inbound, receipt, status, consulta de outbound pendente e confirmação de envio são registradas sem uma camada explícita de HMAC, serviço interno ou RBAC em modules/gateway-adapter/src/presentation/http/gateway.controller.ts.
2. **Sessão com token bruto.** O token é persistido em sessions.token e o login ainda retorna token e csrfToken no JSON. O fluxo web não usa storage, mas a superfície de API continua expondo material de sessão.
3. **Bugs de autorização por operador lógico.** Há uso de && em vez de and(...) em consultas Drizzle no seed e na remoção de papéis, com potencial de selecionar/remover vínculos além do usuário pretendido.
4. **Credenciais administrativas default.** O seed contém admin@cvg.com e admin123, incompatíveis com uma instalação segura sem rotação obrigatória.
5. **Erros SQL externos.** O inbound converte exceções em BadRequestError usando a mensagem original; a resposta observada contém a query e parâmetros do PostgreSQL.

### P1 — confiabilidade e qualidade

6. **Dead-letter em memória.** O estado de falhas é perdido no restart e não é compartilhado entre API, worker e réplicas.
7. **Testes reais não são obrigatórios.** Suites de outbox, schema, chat e rotas podem ser skipped ou falhar por ausência do banco; isso permite falso verde.
8. **Coverage crítico abaixo do gate.** O frontend ficou em 79,08% de statements, com branch/function ainda mais baixos.
9. **Dependências vulneráveis.** Vitest, axios, Vite, OpenTelemetry, ws e outras árvores transitivas aparecem na auditoria atual.
10. **Docker mascara falhas.** O Dockerfile do desk-api usa tsc --noEmit || true, e o runtime executa fonte via tsx em vez de validar uma imagem compilada.

### P1/P2 — maturidade operacional

11. O intervalo assíncrono do worker não tem guarda explícita contra sobreposição.
12. O dashboard D1/D2 não distingue de forma confiável mensagem humana de outbound geral.
13. O endpoint interno /events precisa de autenticação ou isolamento de rede documentado.
14. Kanban permite movimento para usuário autenticado sem permissão de escrita específica.
15. O E2E depende de portas compartilhadas e não isolou a stack do projeto de outros containers do host.
16. A documentação 00-meta/README.md ainda aponta 98/100 como estado atual, apesar dos resultados desta auditoria.

## 7. Critério de declaração de 95/100

Nenhum item poderá ser elevado para 95 apenas por atualizar documentação. A declaração exige:

- todos os P0 fechados e comprovados por teste;
- nenhum high/critical aberto em pnpm audit --audit-level moderate;
- build, lint, typecheck estrito, testes sem cache, coverage e E2E verdes;
- PostgreSQL real disponível em CI e nenhum skip silencioso em suites obrigatórias;
- cobertura mínima de 90% de statements nos pacotes críticos e 80% de branch/function, além dos fluxos E2E;
- gateway, sessão, RBAC, CSRF, rate limit e erros externos validados por testes negativos;
- dead-letter persistente, reprocessável e auditável;
- Docker compilado com falha explícita em erro de tipo;
- relatório de release com evidências, versões, ambiente e riscos residuais aprovados.

Os detalhes de execução estão em:

- Plano executivo: docs/92-plano-executivo-95-todos-itens.md
- Roadmap: docs/93-roadmap-95-todos-itens.md
- Backlog: docs/94-backlog-95-todos-itens.md

## 8. Veredito

O CVG Connect Desk tem base suficiente para uma fase concentrada de hardening. Ainda não tem evidência suficiente para produção. O caminho para 95/100 é fechar segurança e supply chain primeiro, tornar a infraestrutura de teste honesta, persistir operação de falhas, elevar a cobertura e repetir a auditoria em ambiente limpo.
