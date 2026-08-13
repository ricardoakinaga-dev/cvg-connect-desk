# Backlog de Recuperação para 95/100

**Data:** 2026-08-12  
**Baseline:** 91-relatorio-auditoria-atual-74.md  
**Plano:** 92-plano-executivo-95-todos-itens.md  
**Roadmap:** 93-roadmap-95-todos-itens.md

## 1. Convenções

| Prioridade | Significado |
|---|---|
| P0 | Bloqueia segurança, integridade de dados, evidência dos testes ou declaração de 95. |
| P1 | Necessário para confiabilidade, operação e score >=95. |
| P2 | Governança, acabamento e manutenção do score depois dos bloqueios. |

Owners são papéis responsáveis pela entrega; devem ser substituídos por nomes no planejamento do time.

## 2. Visão consolidada

| ID | Prioridade | Item | Owner | Esforço | Dependência | Score impactado |
|---|---|---|---|---:|---|---|
| SEC-01 | P0 | Proteger endpoints do gateway | Backend/Security | 3d | nenhuma | Segurança, API, gateway |
| SEC-02 | P0 | Validar payload, replay e rate limit do gateway | Backend/QA | 2d | SEC-01 | Gateway, testes |
| SEC-03 | P0 | Restringir /events e Kanban | Backend/Security | 1d | SEC-01 | API, premium, segurança |
| AUTH-01 | P0 | Hash, rotação e remoção de token da resposta | Auth/DB | 3d | nenhuma | Auth, banco, segurança |
| AUTH-02 | P0 | Corrigir condições Drizzle e matriz RBAC | Auth/Backend | 2d | nenhuma | Auth, RBAC, admin |
| AUTH-03 | P0 | Remover credenciais default do seed | DB/DevOps | 1d | nenhuma | Banco, deploy, segurança |
| ERR-01 | P0 | Sanitizar erros de infraestrutura | Backend | 2d | nenhuma | API, chat, segurança |
| SUP-01 | P0 | Corrigir vulnerabilidades de dependências | Platform | 3d | nenhuma | Supply chain, build |
| BUILD-01 | P0 | Remover mascaramento do Docker/typecheck | Platform | 2d | SUP-01 | Deploy, arquitetura |
| QA-01 | P0 | Tornar PostgreSQL real obrigatório | QA/DevOps | 3d | nenhuma | Testes, banco, chat |
| QA-02 | P0 | Corrigir e executar integração API/chat/webhook | QA/Backend | 3d | QA-01, ERR-01 | API, chat, testes |
| QA-03 | P0 | Criar stack E2E isolada | QA/DevOps | 2d | QA-01 | Frontend, QA, deploy |
| DB-01 | P1 | Migration/seed de sessão e testes de migração | DB | 2d | AUTH-01 | Banco, deploy |
| EVT-01 | P1 | Persistir dead-letter | Events/DB | 4d | DB-01 | Eventos, observabilidade |
| EVT-02 | P1 | Retry, lease e no-overlap do worker | Worker/Events | 3d | EVT-01 | Eventos, runtime |
| EVT-03 | P1 | Realtime multi-processo e ack resiliente | Realtime/Events | 3d | EVT-01 | Realtime, eventos |
| OBS-01 | P1 | Counters e alertas compartilhados | Platform | 3d | EVT-01 | Observabilidade, runtime |
| TS-01 | P1 | Typecheck estrito do runtime e testes críticos | Architecture | 3d | BUILD-01 | Arquitetura, QA |
| TS-02 | P1 | Auditoria de pacotes sem testes/placeholder | QA/Architecture | 2d | TS-01 | Testes, arquitetura |
| COV-01 | P1 | Elevar coverage do desk-web | Frontend/QA | 4d | QA-03 | Frontend, QA |
| COV-02 | P1 | Elevar coverage de API/chat/events | Backend/QA | 4d | QA-02 | API, chat, eventos |
| FE-01 | P1 | Cobrir estados e erros das telas operacionais | Frontend | 3d | COV-01 | Frontend, tasks, notes |
| KPI-01 | P1 | Corrigir semântica D1/D2 | Backend/Product | 3d | QA-01 | Dashboard, chat |
| API-01 | P1 | Completar schemas e validação de datas/limites | Backend | 3d | TS-01 | API, dashboard |
| OPS-01 | P1 | Docker/Compose/healthcheck de produção | Platform | 3d | BUILD-01, EVT-02 | Deploy, runtime |
| PERF-01 | P1 | Carga e SLO em ambiente equivalente | QA/Platform | 2d | OPS-01, QA-03 | Runtime, QA |
| SEC-04 | P1 | Endurecer proxy, headers, CORS e rate limit | Security/Platform | 2d | SEC-01 | Segurança, deploy |
| DOC-01 | P1 | Reconciliar mapa documental e marcar históricos | Tech writer/Lead | 1d | baseline | Documentação |
| GOV-01 | P2 | Automatizar matriz de score e evidências | QA/Lead | 2d | DOC-01 | Documentação, QA |
| REL-01 | P2 | Checklist de release, rollback e runbooks | Platform/Lead | 2d | todos P0/P1 | Deploy, observabilidade |

## 3. Itens detalhados

### SEC-01 — Proteger endpoints do gateway

**Problema:** inbound, receipt, instance-status, pending outbound e sent podem ser registrados sem preHandler de autenticação claro.

**Tarefas:**

- definir contrato de autenticação serviço-a-serviço;
- aplicar HMAC com timestamp/nonce ou credencial interna rotacionável;
- diferenciar operações de integração das ações administrativas;
- rejeitar requests sem assinatura, com assinatura inválida ou fora da janela;
- registrar correlation id sem gravar segredos.

**Aceite:**

- 401 para ausência de credencial;
- 403 para credencial válida sem permissão;
- 401/409 para replay;
- 2xx apenas para assinatura válida e payload válido;
- testes de rota cobrem cada endpoint.

**Evidência:** suite de integração do gateway, revisão de rotas e scan de headers.

### SEC-02 — Validar payload, replay e rate limit do gateway

Adicionar schemas Fastify/Zod para cada evento, limites de tamanho, idempotency key e rate limit separado por integração.

**Aceite:** payload desconhecido, timestamp inválido, corpo excessivo e repetição são rejeitados sem tocar no domínio.

### SEC-03 — Restringir /events e Kanban

Aplicar autenticação e permissão de leitura ao polling interno. Exigir permissão operacional específica para mover cards, sem confiar apenas em usuário autenticado.

**Aceite:** usuário sem permissão recebe 403; consumer interno recebe somente eventos autorizados; teste verifica isolamento.

### AUTH-01 — Hash, rotação e remoção de token da resposta

Criar migration para hash de sessão, invalidar tokens antigos e fazer o login retornar somente usuário, expiração e metadados não secretos.

**Aceite:** banco não contém token reversível; logout/rotação invalidam o valor anterior; nenhum token aparece no JSON, logs ou frontend.

### AUTH-02 — Corrigir condições Drizzle e matriz RBAC

Substituir todos os operadores JavaScript usados em filtros SQL por and(...)/or(...) e cobrir permissões por usuário, papel, equipe e setor.

**Aceite:** seed atribui exatamente o conjunto esperado; remover um papel não remove vínculos de outros usuários; matriz negativa passa.

### AUTH-03 — Remover credenciais default

Eliminar admin@cvg.com/admin123 como credenciais utilizáveis. Bootstrap deve exigir segredo fornecido por ambiente/secret manager e rotação no primeiro acesso.

**Aceite:** instalação sem segredo falha claramente; segredo fraco/default é rejeitado; documentação explica bootstrap seguro.

### ERR-01 — Sanitizar erros de infraestrutura

Separar erro técnico interno de erro externo. Mapear falhas de DB/gateway para código estável, preservar correlation id e registrar detalhes somente no log protegido.

**Aceite:** requests nunca devolvem SQL, parâmetros, stack ou URLs internas; teste de DB indisponível verifica mensagem genérica.

### SUP-01 — Corrigir vulnerabilidades de dependências

Atualizar primeiro Vitest, axios, Vite, ws e OpenTelemetry conforme advisories atuais; revisar overrides e lockfile; executar testes completos após cada grupo.

**Aceite:** pnpm audit --audit-level moderate passa ou qualquer exceção residual tem owner, CVE, mitigação, prazo e aprovação explícita. Para a meta 95, critical/high não podem permanecer.

### BUILD-01 — Remover mascaramento do Docker/typecheck

Remover tsc --noEmit || true, eliminar execução de fonte com tsx em produção e construir artefatos tipados em estágio de build.

**Aceite:** erro de tipo falha a imagem; container executa dist; smoke da imagem compilada passa.

### QA-01 — Tornar PostgreSQL real obrigatório

Criar comando de provisionamento com porta dedicada, readiness, migrations, seed controlado e cleanup. Introduzir REQUIRE_REAL_DB=1 nas suites que hoje fazem skip.

**Aceite:** sem DB o comando termina não-zero; com DB todas as suites real-db executam; relatório diferencia passed/failed/skipped e não aceita skip obrigatório.

### QA-02 — Corrigir integração API/chat/webhook

Executar as suites sem cache com banco real, corrigir fixtures, cleanup e contratos; investigar os 400 de webhook após o banco estar disponível.

**Aceite:** auth, chat, contacts, Kanban, dead-letter, events polling, webhook e dashboard passam em execução limpa.

### QA-03 — Criar stack E2E isolada

Usar projeto/namespace e portas alocadas dinamicamente, sem derrubar containers de terceiros. A stack deve subir API, web, realtime, DB e Redis com healthchecks.

**Aceite:** login, inbox, mensagem, tarefa, nota, alerta, admin/RBAC e dashboard passam em CI; execução concorrente não colide.

### DB-01 — Migration/seed de sessão e testes de migration

Validar migrations em banco vazio e banco com dados; testar rollback/forward compatibility quando aplicável.

**Aceite:** migration limpa é reproduzível; sessão antiga é tratada; seed é idempotente e não atribui permissões indevidas.

### EVT-01 — Persistir dead-letter

Criar tabela com event id, tipo, payload, erro, tentativas, status, source event, timestamps, owner e resolução. Migrar API/admin/worker para repository compartilhado.

**Aceite:** falha sobrevive ao restart; duas instâncias enxergam o mesmo item; retry e resolução são idempotentes e auditados.

### EVT-02 — Retry, lease e no-overlap do worker

Adicionar lock/lease por evento, backoff, limite de concorrência e guarda de polling. Corrigir healthcheck para verificar o processo e sua capacidade de buscar/ack.

**Aceite:** duas execuções não processam o mesmo evento simultaneamente; falha transitória é reprocessada; falha permanente vai para DLQ.

### EVT-03 — Realtime multi-processo e ack resiliente

Testar outbox polling/ack em mais de uma instância, eventos não projetáveis e reconexão com cookie/revalidação.

**Aceite:** nenhum evento é perdido por uma instância que não consegue projetá-lo; ack segue política explícita; testes cobrem restart e revogação.

### OBS-01 — Counters e alertas compartilhados

Remover dependência de Maps locais para métricas operacionais importantes. Expor backlog, age, retry e DLQ por fonte compartilhada.

**Aceite:** métricas são consistentes entre réplicas; alertas para backlog, 5xx, falha de webhook e DLQ têm limiar e runbook.

### TS-01 — Typecheck estrito

Criar um comando que execute TypeScript estrito nos runtime sources e suites críticas, sem transpile-only e sem exclusões ocultas.

**Aceite:** pnpm run typecheck:strict falha em qualquer erro; resultado é executado no CI e arquivado.

### TS-02 — Auditoria de pacotes sem testes/placeholder

Listar pacotes com --passWithNoTests, scripts echo e wrappers permissivos. Cada pacote deve ter teste ou justificativa formal.

**Aceite:** nenhum pacote crítico passa sem teste; exceções têm escopo, owner e prazo.

### COV-01 — Coverage do desk-web

Cobrir Login, Inbox, Layout, Notes, Alerts, Dashboard, Admin, Kanban e estados loading/empty/error/permission.

**Aceite:** statements >=90%, branch/function >=80%; cobertura não depende de cache ou ordem de execução.

### COV-02 — Coverage de API/chat/events

Cobrir rotas negativas, erros, auth, gateway contracts, idempotência, outbox, retry e DLQ.

**Aceite:** cada pacote crítico >=90% statements e >=80% branch/function; fluxos P0 têm teste de integração.

### FE-01 — Estados e erros das telas operacionais

Remover catches silenciosos de mutações, exibir feedback consistente, tratar sessão expirada e validar permissões no frontend e backend.

**Aceite:** cada ação mutável possui estado de sucesso/erro; E2E verifica feedback e não apenas renderização.

### KPI-01 — Semântica D1/D2

Modelar explicitamente sender type, handler e handoff. D1 deve medir primeira resposta humana definida; D2 deve medir handoff conforme regra de produto.

**Aceite:** fixtures com bot, humano, inbound e outbound produzem valores esperados; documentação de fórmula e timezone existe.

### API-01 — Schemas e validação

Adicionar validação de datas, intervalos start/end, limites, enumerações e mensagens de erro estáveis nos endpoints de dashboard e operações.

**Aceite:** datas inválidas e intervalos invertidos retornam 400; limites não permitem consultas sem controle; schemas aparecem no Swagger.

### OPS-01 — Docker/Compose/healthcheck

Separar build/runtime, remover flags permissivas, exigir segredos em produção, corrigir CORS default e healthcheck do worker.

**Aceite:** compose de produção falha cedo sem segredo; healthcheck detecta processo quebrado; imagem não depende de ferramentas de desenvolvimento.

### PERF-01 — Carga e SLO

Executar carga em ambiente semelhante à produção, com p95, erro 5xx, throughput e backlog de eventos.

**Aceite:** SLO aprovado e arquivado; thresholds falham explicitamente; relatório inclui perfil, commit e configuração.

### SEC-04 — Proxy, headers, CORS e rate limit

Configurar trust proxy por lista/conhecido, reativar CSP compatível, limitar CORS a origens explícitas e decidir comportamento fail-closed do rate limiter.

**Aceite:** headers e origem são testados em produção; proxy não permite spoof de IP; rate limiter não degrada silenciosamente.

### DOC-01 — Reconciliar documentação

Atualizar docs/00-meta/README.md, marcar 72–90 como históricos quando necessário e apontar 91–94 como linha atual.

**Aceite:** um novo leitor encontra baseline 74, objetivo 95, roadmap e backlog sem depender de claims históricas.

### GOV-01 — Automatizar matriz de score

Criar template de score com item, nota, evidência, comando, owner, data, risco residual e decisão.

**Aceite:** toda nota >=95 aponta para artefato executado; alteração documental sem evidência não altera score.

### REL-01 — Release, rollback e runbooks

Documentar migration, rollback, rotação de secrets, recuperação de DLQ, incidentes de gateway, indisponibilidade de DB e expiração de sessão.

**Aceite:** runbooks são executados em tabletop ou staging; owner/on-call e critérios de escalonamento definidos.

## 4. Ordem de execução

1. SEC-01 a SEC-04, AUTH-01 a AUTH-03 e ERR-01.
2. SUP-01, BUILD-01, TS-01 e OPS-01.
3. QA-01, DB-01, QA-02 e QA-03.
4. EVT-01 a EVT-03 e OBS-01.
5. COV-01, COV-02, FE-01, KPI-01 e API-01.
6. PERF-01, DOC-01, GOV-01 e REL-01.

## 5. Definição de pronto do backlog

Um item só pode ser marcado como concluído quando possui:

- implementação revisada;
- teste positivo e negativo quando aplicável;
- comando executado sem cache;
- evidência arquivada com data/commit;
- documentação atualizada;
- nenhum risco crítico novo introduzido;
- owner e reviewer identificados.
