# Plano Executivo para 95/100 em Todos os Itens

**Data:** 2026-08-12  
**Baseline:** 74/100, conforme 91-relatorio-auditoria-atual-74.md  
**Objetivo:** elevar cada um dos 18 itens auditados para no mínimo 95/100  
**Horizonte de planejamento:** 10 semanas relativas, com execução paralela por frentes  
**Regra:** não declarar 95 sem evidência nova e reproduzível

## 1. Decisão executiva

O produto entra em **freeze de novas features** até os gates P0 de segurança, dados e qualidade ficarem verdes. O trabalho deve concentrar-se em transformar comportamento existente em operação segura, testável e observável.

Sequência de decisão:

1. Conter exposição e corrigir autorização.
2. Remover segredos/tokens inadequados e eliminar vazamento de SQL.
3. Tornar compilação, dependências e testes fontes confiáveis de verdade.
4. Persistir falhas operacionais e fechar runtime.
5. Completar cobertura frontend, métricas e E2E.
6. Reexecutar auditoria em ambiente limpo e só então atualizar o score.

Não fazem parte desta fase CRM completo, BI avançado, HIS, marketing, funil comercial ou novas integrações não necessárias ao Desk operacional.

## 2. Metas executivas de saída

| Gate | Meta de saída |
|---|---|
| Segurança de integração | Todas as rotas do gateway autenticadas, autorizadas, validadas, limitadas e com proteção contra replay. |
| Sessão | Token persistido somente como hash; login não retorna segredo; cookie HttpOnly/Secure/SameSite e CSRF testados. |
| RBAC | Consultas de papel/permissão corrigidas, seed sem credenciais default e matriz negativa de autorização aprovada. |
| Erros | Respostas externas nunca contêm SQL, parâmetros, stack ou segredo; logs internos mantêm correlação. |
| Supply chain | Auditoria sem critical/high e todos os moderate com correção ou exceção formal com prazo. |
| Compilação | Typecheck estrito do runtime e dos testes críticos; Docker falha explicitamente em erro. |
| Banco/testes | PostgreSQL descartável provisionado automaticamente; suites obrigatórias falham se o banco não estiver disponível. |
| Coverage | Pacotes críticos com pelo menos 90% statements e 80% branch/function; fluxos centrais cobertos. |
| E2E | Login, inbox, mensagem, tarefa, nota, alerta, admin/RBAC e dashboard executados em stack isolada. |
| Eventos | Dead-letter persistente, retry/reprocessamento auditável e worker sem sobreposição. |
| KPIs | D1/D2 baseados em classificação explícita de mensagens e handoff, com testes de contrato. |
| Runtime | Imagens compiladas, healthchecks reais, segredos obrigatórios e configuração de produção validada. |
| Documentação | Um único mapa de estado atual; documentos históricos marcados e score atualizado somente após gates. |

## 3. Scorecard de recuperação

| Item | Atual | Alvo | Entrega que sustenta 95 |
|---|---:|---:|---|
| Documentação/rastreabilidade | 55 | 95 | Relatório atual, matriz de evidências, CI/QA log e política de atualização. |
| Escopo funcional | 84 | 95 | Matriz MVP/adjacente/futuro e E2E dos fluxos que já existem. |
| Arquitetura/monorepo | 86 | 95 | Typecheck estrito, contratos de integração e auditoria de acoplamentos. |
| Banco/migrations | 82 | 95 | Hash de sessão, migrations de DLQ, seed seguro e teste de migração limpa. |
| Backend/API | 79 | 95 | Schemas, auth por rota, erros sanitizados e testes de contrato. |
| Chat/webhook | 80 | 95 | HMAC/replay, idempotência real, DB obrigatório e respostas sem SQL. |
| Secretary/handoff | 86 | 95 | Contrato timeout/retry/falha, auditoria e E2E de handoff. |
| Tasks/notes/alerts | 83 | 95 | Permissões, rotas reais, estados de erro e E2E operacional. |
| Premium/Kanban/contacts | 75 | 95 | Authorization matrix, testes de Kanban/gateway e integração HTTP real. |
| Auth/RBAC/sessões | 78 | 95 | Token hash, rotação, sem segredo no JSON, correção de operadores e testes negativos. |
| Segurança geral | 62 | 95 | Threat model fechado, headers/proxy/rate limit endurecidos e scan limpo. |
| Outbox/worker/realtime | 86 | 95 | DLQ DB, lease/idempotência, no-overlap, revalidação e testes multi-processo. |
| Frontend | 80 | 95 | Cobertura de páginas/estados, E2E e tratamento explícito de erros. |
| Dashboard/KPIs | 74 | 95 | Métricas com semântica de autor/remetente/handoff e testes com dados reais. |
| Observabilidade | 72 | 95 | Counters persistentes/centralizados, alertas e runbooks de operação. |
| Testes/QA/CI | 60 | 95 | Sem skip silencioso, DB/E2E em CI, cobertura e gates sem cache. |
| Dependências | 38 | 95 | Atualizações aprovadas, lockfile consistente e auditoria sem high/critical. |
| Deploy/runtime | 72 | 95 | Docker compilado, healthcheck real, compose seguro e smoke isolado. |

## 4. Frentes de trabalho

### F1 — Segurança de borda e autorização

**Responsável:** engenharia backend + segurança  
**Prazo:** semanas 1–2  
**Itens:** gateway, /events, Kanban, RBAC, rate limit, trust proxy, headers e CORS.

Entregas:

- middleware de autenticação de serviço/HMAC para gateway;
- schemas de payload e limites de tamanho;
- nonce/timestamp ou idempotency key contra replay;
- autorização por operação e equipe;
- revisão de trustProxy, CSP, CORS e rate limit fail-open;
- testes 401/403, assinatura inválida, replay, role insuficiente e payload inválido.

### F2 — Sessão, seed e tratamento de erro

**Responsável:** auth/backend/database  
**Prazo:** semanas 1–3  
**Itens:** token hash, resposta de login, rotação, seed, queries Drizzle e SQL leak.

Entregas:

- migration de token_hash e invalidação de tokens antigos;
- comparação segura e ausência de token no corpo de login;
- remoção de defaults inseguros e bootstrap administrável por ambiente;
- substituição sistemática de && por and(...) nas consultas;
- camada de erro externo com códigos estáveis e logs correlacionados.

### F3 — Supply chain, typecheck e imagens

**Responsável:** platform/DevOps  
**Prazo:** semanas 2–4  
**Itens:** audit, lockfile, typecheck estrito e Dockerfiles.

Entregas:

- atualizar dependências vulneráveis e revisar breaking changes;
- remover tsc --noEmit || true;
- compilar artefatos para dist e executar imagem compilada;
- healthcheck que verifica processo e endpoint real;
- gate que falha em warning crítico, erro de tipo ou auditoria não aprovada.

### F4 — Banco real e honestidade dos testes

**Responsável:** QA + DevOps  
**Prazo:** semanas 2–5  
**Itens:** PostgreSQL, migrations, suites de integração e skips.

Entregas:

- stack PostgreSQL/Redis isolada por execução;
- readiness e migração automática antes dos testes;
- modo obrigatório REQUIRE_REAL_DB=1;
- suites real-db falham com dependência ausente, em vez de skip silencioso;
- fixtures idempotentes e cleanup seguro.

### F5 — Eventos e operação de falhas

**Responsável:** backend/platform  
**Prazo:** semanas 4–6  
**Itens:** dead-letter, worker, outbox, realtime e observabilidade.

Entregas:

- tabela/repositório persistente de dead-letter;
- retry com lease, backoff e idempotência;
- guarda contra sobreposição do polling do worker;
- retry/resolução admin auditáveis;
- métricas compartilhadas e alertas de backlog/falha.

### F6 — Frontend, KPIs e fluxos operacionais

**Responsável:** frontend + produto/QA  
**Prazo:** semanas 5–7  
**Itens:** coverage web, erros de UI, dashboard, tasks/notes/alerts e premium.

Entregas:

- cobertura de páginas críticas, estados vazio/loading/erro e permissões;
- sem catches silenciosos em operações mutáveis;
- D1/D2 com classificação de autor/remetente e handoff explícita;
- E2E dos fluxos operacionais já implementados;
- Kanban, contatos e transferências testados via API real.

### F7 — Release validation e governança

**Responsável:** tech lead + QA + segurança  
**Prazo:** semanas 8–10  
**Itens:** performance, E2E, documentação e score.

Entregas:

- ambiente staging/produção equivalente;
- smoke/E2E isolado em CI;
- teste de carga com SLO documentado;
- checklist de release assinado;
- auditoria final com 18 notas >=95 e riscos residuais aprovados.

## 5. Modelo de governança

- **Daily técnico:** bloqueadores P0, falhas novas e dependências.
- **Revisão semanal:** score provisório por frente, evidências e decisões de risco.
- **Gate de mudança:** nenhum PR reduz cobertura, remove autorização ou introduz skip sem justificativa.
- **Owner único por item:** cada backlog item possui responsável por função, mesmo quando a execução é compartilhada.
- **Evidência obrigatória:** comando, ambiente, data, resultado e link para artefato.
- **Reclassificação:** só a auditoria final altera as notas; progresso intermediário fica como “em recuperação”.

## 6. Condição de encerramento

O plano só termina quando:

1. todos os itens do backlog P0 estão concluídos;
2. todos os gates técnicos executam sem cache em ambiente limpo;
3. nenhum teste obrigatório é skipped;
4. o relatório final apresenta evidência dos 18 itens;
5. cada nota é no mínimo 95;
6. o working tree de release é reproduzível a partir do lockfile e das migrations.

O roadmap operacional está em 93-roadmap-95-todos-itens.md e os tickets em 94-backlog-95-todos-itens.md.
