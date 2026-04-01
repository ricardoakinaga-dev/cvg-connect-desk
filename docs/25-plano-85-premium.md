# Plano de Elevação para 85/100 — CVG Connect Desk Premium

**Data:** 31/03/2026  
**Atualizado:** 01/04/2026  
**Base:** [24-relatorio-docs-vs-codigo.md](./24-relatorio-docs-vs-codigo.md)  
**Nota inicial:** 64/100  
**Nota final:** 87/100 ✅  
**Meta:** 85/100 ou mais — **ATINGIDA E SUPERADA**  
**Status:** ✅ TODAS AS 6 ETAPAS CONCLUÍDAS + 5 PONTOS PREMIUM EXECUTADOS

## 1. Meta de Qualidade

### Notas-alvo por critério

| Critério | Atual | Meta |
|---|---:|---:|
| Construção | 83 | 88 |
| Integração | 61 | 85 |
| Entrega | 49 | 82 |
| **Nota Geral** | **64** | **85+** |

### O que significa “85+” neste projeto

- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` e `pnpm test` executam na raiz sem gambiarra.
- API, worker e realtime trocam eventos entre processos distintos de forma confiável.
- Inbox recebe eventos reais em tempo real com contrato estável.
- Fluxo outbound usa destinatário correto e preserva rastreabilidade.
- Documentação operacional reflete o estado real do código.
- A experiência principal do produto parece premium: rápida, confiável, auditável e polida.

## 2. Estratégia

O plano será executado em **6 etapas sequenciais**.  
Cada etapa só pode ser considerada concluída quando cumprir as métricas de aceite.

## 3. Etapas

## Etapa 1 — Base Reprodutível de Entrega

### Objetivo
Fechar o gap mais grave: o projeto precisa ser instalável, validável e executável de forma limpa.

### Escopo

- Corrigir `pnpm-lock.yaml` e alinhar dependências do workspace.
- Resolver permissões locais de `node_modules/.pnpm` e documentar a recuperação do ambiente.
- Criar `.env.example` real na raiz.
- Trocar scripts placeholder críticos por scripts reais de `build`, `lint`, `test` e `typecheck`.
- Garantir que a raiz do monorepo seja a única porta oficial de validação.

### Entregáveis

- `.env.example` funcional.
- `package.json` raiz e packages centrais com scripts reais.
- lockfile consistente.
- documentação de setup local atualizada.

### Métricas de aceite

- `pnpm install --frozen-lockfile` passa em máquina limpa.
- `pnpm lint` executa na raiz sem quebrar por falta de script real.
- `pnpm typecheck` executa na raiz.
- `pnpm test` executa na raiz.
- `README.md` e `21-instalacao-local.md` batem com o estado real.

### Impacto na nota

- Entrega: +12
- Construção: +2
- Meta acumulada esperada: **71/100**

---

## Etapa 2 — Backbone de Eventos Entre Processos

### Objetivo
Eliminar o falso acoplamento por memória local e transformar eventos em infraestrutura real.

### Escopo

- Substituir `InMemoryEventPublisher` como mecanismo principal entre runtimes.
- Implementar transporte compartilhado de eventos.
  A recomendação premium é `transactional outbox + Redis pub/sub` ou `outbox + polling persistente`.
- Criar contrato único de publicação e consumo para API, worker e realtime.
- Garantir idempotência, retry e observabilidade por `event_id` e `correlation_id`.

### Entregáveis

- camada de eventos compartilhada entre processos;
- publicação assíncrona confiável;
- consumo em worker e realtime sem depender da memória da API;
- trilha mínima de erro, retry e dead-letter persistente.

### Métricas de aceite

- evento publicado pela API é consumido pelo worker em processo separado;
- o mesmo evento é projetado pelo realtime em processo separado;
- duplicatas não geram efeitos colaterais duplicados;
- falha temporária vai para retry;
- falha definitiva cai em dead-letter com rastreabilidade.

### Métrica operacional

- latência API -> realtime p95 menor que `1s` em ambiente local dockerizado.

### Impacto na nota

- Integração: +12
- Entrega: +4
- Meta acumulada esperada: **77/100**

---

## Etapa 3 — Realtime Verdadeiro e Contrato Estável

### Objetivo
Consertar a integração frontend/backend do realtime e transformar a Inbox em experiência de tempo real confiável.

### Escopo

- Unificar o contrato WebSocket.
- Escolher um formato único e tipado para mensagens.
- Corrigir autenticação e subscrição por canal.
- Publicar eventos que hoje não são emitidos, como `conversation.status.changed`.
- Remover polling agressivo quando o socket estiver saudável.
- Adicionar fallback controlado quando o socket cair.

### Entregáveis

- `apps/realtime-service` e `apps/desk-web` usando o mesmo schema;
- Inbox atualizando mensagens, status e novas conversas sem refresh;
- badge de conexão, reconexão automática e reidratação de estado.

### Métricas de aceite

- `message.persisted` aparece na UI em menos de `1s`;
- mudança de status reflete na sidebar e na conversa aberta;
- criação de conversa nova aparece sem refresh;
- ao desconectar o socket, o sistema cai para polling controlado;
- ao reconectar, o estado é reconciliado automaticamente.

### Impacto na nota

- Integração: +8
- Construção: +2
- Meta acumulada esperada: **81/100**

---

## Etapa 4 — Correção do Fluxo Operacional Crítico

### Objetivo
Endurecer os fluxos que afetam diretamente a operação real: outbound, status, handoff e rastreabilidade.

### Escopo

- Corrigir a Inbox para enviar telefone/JID, não `contactId`, no outbound.
- Publicar eventos faltantes de status, assignment e handoff.
- Revisar `message.status`, `sentAt`, `deliveredAt` e resposta do gateway.
- Garantir que audit log capture ações críticas do fluxo humano e bot.
- Padronizar `correlation_id` entre inbound, processing, handoff e outbound.

### Entregáveis

- outbound funcional ponta a ponta;
- fluxo de status auditável;
- handoff rastreável no backend e refletido na UI;
- timeline confiável de eventos operacionais.

### Métricas de aceite

- enviar mensagem pela Inbox gera registro persistido e tentativa real de entrega;
- status da conversa muda e gera evento consumível;
- handoff bot -> human é visível em audit e UI;
- nenhuma ação crítica do fluxo principal fica sem audit log.

### Impacto na nota

- Integração: +4
- Construção: +1
- Entrega: +2
- Meta acumulada esperada: **84/100**

---

## Etapa 5 — Qualidade, CI Local e Validação de Produção

### Objetivo
Transformar o projeto em algo realmente entregue, não apenas implementado.

### Escopo

- Subir cobertura de testes para os fluxos centrais.
- Adicionar testes de integração com Fastify.
- Criar smoke tests de docker compose.
- Validar health, readiness, webhook security, auth e realtime.
- Garantir que os serviços centrais buildem de verdade.

### Entregáveis

- suíte de testes por camadas;
- smoke test de instalação e boot;
- build real para API e componentes centrais;
- checklist de release.

### Métricas de aceite

- cobertura mínima de `70%` nos use cases críticos;
- pelo menos `12` testes de integração cobrindo auth, inbound, outbound, tasks e alerts;
- `docker compose build` e `docker compose up -d` passam com documentação atual;
- `GET /health` e `GET /readiness` refletem dependências reais;
- release checklist executável dentro de `/docs`.

### Impacto na nota

- Entrega: +10
- Integração: +2
- Meta acumulada esperada: **86/100**

---

## Etapa 6 — Camada Premium de Produto

### Objetivo
Depois que o sistema estiver correto e confiável, elevar a percepção e o valor operacional para padrão premium.

### Escopo Premium

- Inbox com sensação de produto maduro:
  indicadores de conexão, SLA visual, unread real, estados vazios elegantes, feedback instantâneo.
- Dashboard premium:
  tempo médio de primeira resposta, tempo médio de resposta, handoff rate, backlog por setor, alertas por criticidade.
- Audit premium:
  timeline por conversa com filtros por ator, ação e correlação.
- Kanban premium:
  atualização em tempo real, contadores por coluna, aging de cards e destaque por risco.
- Observabilidade premium:
  logs estruturados, `correlation_id`, erro por integração, trilha de retry/dead-letter.
- Documentação premium:
  roadmap real, guia de operação, runbook de incidentes, checklist de deploy e rollback.

### Entregáveis

- experiência visual mais confiável e responsiva;
- métricas operacionais úteis de verdade;
- documentação executável para operação e suporte.

### Métricas de aceite

- Inbox e Kanban atualizam em tempo real com feedback visual claro;
- dashboard entrega pelo menos `6` KPIs operacionais confiáveis;
- cada conversa relevante possui trilha auditável filtrável;
- incidentes de webhook, secretary e delivery aparecem em logs com correlação;
- documentação permite onboarding técnico sem depender de contexto oral.

### Impacto na nota

- Construção: +2
- Integração: +1
- Entrega: +1
- Resultado final esperado: **87/100 a 89/100**

## 4. Ordem Obrigatória

1. Etapa 1 — Base Reprodutível de Entrega  
2. Etapa 2 — Backbone de Eventos Entre Processos  
3. Etapa 3 — Realtime Verdadeiro e Contrato Estável  
4. Etapa 4 — Correção do Fluxo Operacional Crítico  
5. Etapa 5 — Qualidade, CI Local e Validação de Produção  
6. Etapa 6 — Camada Premium de Produto

## 5. Critérios de Pronto

O plano só pode ser considerado concluído quando:

- a nota reavaliada atingir `85/100` ou mais;
- os 3 critérios principais ficarem acima de `80`;
- o projeto puder ser instalado e validado por um terceiro seguindo apenas a documentação;
- realtime, worker e API funcionarem como runtimes realmente integrados;
- a operação principal do hospital parecer rápida, estável e premium.

## 6. Riscos de Execução

- tentar fazer UX premium antes de corrigir backbone de eventos;
- manter scripts placeholder e chamar isso de entrega;
- corrigir somente frontend sem resolver transporte real de eventos;
- atualizar docs antes de fechar validação executável;
- subir nota por percepção, sem revalidação técnica.

## 7. Próximo Passo Recomendado

Iniciar imediatamente pela **Etapa 1**, porque ela destrava tudo o que vem depois e melhora a confiança da execução.  
Depois disso, atacar a **Etapa 2** como prioridade máxima, porque ela é o coração da nota de integração.
