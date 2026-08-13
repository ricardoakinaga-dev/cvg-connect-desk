# Roadmap para 95/100 em Todos os Itens

**Data:** 2026-08-12  
**Baseline:** 74/100  
**Alvo:** 95/100 em cada item auditado  
**Horizonte:** 10 semanas relativas  
**Plano executivo:** 92-plano-executivo-95-todos-itens.md  
**Backlog:** 94-backlog-95-todos-itens.md

> As semanas são relativas ao início da execução. Não representam promessa de calendário sem confirmação de capacidade, ambiente e responsáveis.

## 1. Visão de dependências

Fluxo principal:

W0 Baseline  
→ W1–W2 Segurança de borda e sessões  
→ W2–W4 Supply chain, typecheck e Docker  
→ W2–W5 PostgreSQL real e testes sem skip  
→ W4–W6 Eventos, DLQ e observabilidade  
→ W5–W7 Frontend, KPIs e E2E  
→ W8–W10 Staging, performance e auditoria 95

As frentes de segurança e banco podem começar em paralelo. A auditoria final depende de todas as demais, porque score alto sem evidência de runtime não é aceito.

## 2. Roadmap por marcos

| Marco | Janela | Prioridade | Entregas | Saída obrigatória |
|---|---|---|---|---|
| M0 — Baseline congelado | W0 | P0 | Inventário de gaps, owners, branch de release e matriz de score | Todos os 18 itens com nota, gap e ticket. |
| M1 — Exposição contida | W1–W2 | P0 | Gateway protegido, /events restrito, RBAC corrigido, session hardening iniciado | Testes negativos de 401/403/replay verdes. |
| M2 — Sessão e erro seguros | W1–W3 | P0 | Token hash, sem token no JSON, seed sem default, SQL sanitizado | Scan estático e integração auth aprovados. |
| M3 — Gates técnicos honestos | W2–W4 | P0 | Audit corrigido, typecheck estrito, Docker compilado | Build, lint, typecheck e audit sem mascaramento. |
| M4 — Banco real obrigatório | W2–W5 | P0 | Stack PostgreSQL isolada, migrations, fixtures e no-skip | Suites real-db falham quando o banco não sobe e passam quando sobe. |
| M5 — Operação resiliente | W4–W6 | P1 | DLQ persistente, retry/lease, worker no-overlap, métricas centralizadas | Reinício não perde falhas; retry é auditável. |
| M6 — Experiência comprovada | W5–W7 | P1 | Coverage web/API, estados de UI, KPIs semânticos, API premium testada | Coverage crítico >=90% statements; fluxos E2E centrais verdes. |
| M7 — Release candidate | W8–W9 | P1 | Staging equivalente, smoke/E2E isolado, performance e segurança | SLO aprovado, zero P0/P1 aberto. |
| M8 — Auditoria final | W10 | P0 | Reexecução sem cache, relatório, scorecard e atualização do mapa docs | 18/18 itens >=95 com evidência arquivada. |

## 3. Detalhamento por semana

### W0 — Fixar a verdade

- registrar commit/working tree de referência;
- confirmar ambiente de teste e portas dedicadas;
- gerar matriz de score atual;
- congelar novas features;
- abrir os itens GOV-01, QA-01 e QA-02.

**Gate:** nenhum item pode mudar de nota sem evidência posterior à baseline.

### W1 — Fechar exposição pública

- implementar autenticação do gateway;
- definir separação entre assinatura de integração e RBAC de operador;
- restringir /events;
- exigir permissão de escrita para mover cards no Kanban;
- revisar CORS, trust proxy, CSP e rate limit.

**Gate:** requests sem credencial, assinatura inválida, replay e role insuficiente falham de modo previsível.

### W2 — Corrigir sessão e autorização

- migration de hash de sessão;
- remover token do JSON de login;
- corrigir queries com and(...);
- remover credenciais default;
- adicionar matriz de autorização negativa.

**Gate:** sessão antiga é invalidada/rotacionada e nenhum segredo aparece em resposta, log ou storage web.

### W3 — Tornar erros e dependências governáveis

- sanitizar exceções de infraestrutura;
- atualizar dependências vulneráveis;
- rodar auditoria de breaking changes;
- substituir wrappers de typecheck por comandos estritos;
- iniciar remoção de tsc || true.

**Gate:** nenhum erro externo contém SQL/stack; audit e typecheck passam em execução limpa.

### W4 — Provisionar banco real

- Compose de teste com projeto/portas dedicadas;
- readiness, migrations e seed controlado;
- fixtures por suíte;
- REQUIRE_REAL_DB=1;
- separar suites unitárias de suites de integração.

**Gate:** suites de banco passam com PostgreSQL ativo e falham explicitamente quando o pré-requisito está ausente.

### W5 — Fechar integração e eventos

- executar API/chat/webhook com banco real;
- validar idempotência e receipts;
- criar tabela e repository de DLQ;
- migrar endpoints admin para fonte persistente;
- adicionar lease/retry no worker.

**Gate:** uma mensagem não duplica, uma falha sobrevive ao restart e um retry não duplica efeitos.

### W6 — Realtime, worker e observabilidade

- testar múltiplas instâncias;
- impedir polling sobreposto;
- corrigir healthcheck real do worker;
- publicar counters e backlog em fonte compartilhada;
- criar alertas e runbook.

**Gate:** restart, concorrência e falhas transitórias são cobertos sem perda silenciosa.

### W7 — Frontend e KPIs

- cobrir páginas e estados de erro;
- remover catches silenciosos em mutações;
- testar permissão por página/ação;
- corrigir D1/D2 com dados classificados;
- executar E2E de fluxo operacional.

**Gate:** coverage crítico e E2E atingem as metas do plano.

### W8–W9 — Release candidate

- construir imagens sem ferramentas de desenvolvimento;
- subir ambiente semelhante à produção;
- executar smoke, integração, E2E e carga;
- executar scan de dependências e segurança;
- revisar rollback, migrations e segredos.

**Gate:** zero P0/P1 aberto e todos os SLOs dentro do limite aprovado.

### W10 — Reauditoria

- repetir comandos sem cache;
- anexar logs e relatórios;
- atualizar score somente item a item;
- marcar docs antigos como históricos;
- aprovar ou rejeitar a liberação.

**Gate final:** 18/18 itens >=95, não apenas média geral.

## 4. Gates do roadmap

| Gate | Comprovação |
|---|---|
| G1 — Segurança | Testes de gateway/auth/RBAC, scanner de secrets e revisão manual de rotas. |
| G2 — Qualidade | Build, lint, typecheck estrito, testes sem cache e coverage. |
| G3 — Dados | Migrations limpas, PostgreSQL real, idempotência e cleanup. |
| G4 — Operação | DLQ persistente, worker/realtime, health/readiness e alertas. |
| G5 — Produto | E2E de login, inbox, mensagem, tarefa, nota, alerta, admin e dashboard. |
| G6 — Runtime | Docker compilado, Compose seguro, smoke isolado e rollback testado. |
| G7 — Governança | Relatório atual, matriz de score, backlog fechado e docs históricos marcados. |

## 5. Progressão indicativa de score

Esta progressão é uma expectativa de gestão, não uma nota automática:

| Marco | Score esperado se o gate passar |
|---|---:|
| Baseline M0 | 74 |
| M2 — P0 de segurança fechado | 82–86 |
| M4 — testes reais e gates honestos | 88–91 |
| M6 — operação e coverage fechados | 92–94 |
| M8 — release validation e auditoria | 95+ em cada item |

Se um gate falhar, a nota correspondente permanece na baseline, mesmo que outras frentes tenham avançado.
