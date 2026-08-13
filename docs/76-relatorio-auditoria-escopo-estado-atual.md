# Relatorio de Auditoria: Escopo, Direcao e Estado Atual

**Data:** 2026-04-27  
**Escopo:** documentacao principal, roadmap/backlog 96%, codigo em `apps/`, `modules/`, `packages/`, scripts de QA e verificacoes locais.  
**Resultado consolidado:** **76/100**

## 1. Resumo executivo

O CVG Connect Desk esta majoritariamente na direcao correta de produto: uma camada operacional para atendimento digital do hospital veterinario, preservando Gateway, Evolution API e Agent Secretary como sistemas externos de mensageria, canal e automacao.

O produto implementado cobre grande parte do MVP documentado: chat, inbox, mensagens inbound/outbound, tasks, notes, alerts, admin, dashboard, audit, eventos, realtime e integracoes. A expansao para contacts, labels, sectors, transfers, contact-groups e kanban ainda parece adjacente ao dominio operacional, mas precisa ser formalmente governada para nao virar CRM, BI avancado ou plataforma premium fora do escopo.

O principal problema encontrado nao e direcao de produto. O problema e que a documentacao recente sugere uma maturidade operacional proxima de 96/100, mas os gates tecnicos executados no estado atual ainda falham: `build`, `typecheck`, `lint`, `pnpm test`, `pnpm audit` e `qa:full-cycle`.

## 2. Escopo documentado

Fonte principal:

- `docs/01-product-vision.md`
- `docs/02-business-context.md`
- `docs/03-scope-and-non-scope.md`
- `docs/72-roadmap-98-porcento.md`
- `docs/73-backlog-98-porcento.md`
- `docs/75-roadmap-98-porcento.md`

O MVP real definido pela documentacao e restrito aos blocos:

- Chat core.
- Tasks.
- Notes.
- Alerts.
- Admin basico.
- Dashboard inicial.
- Audit logs.
- Secretary Adapter.
- Integracao preservando Gateway, Evolution API e Secretary.

Fora de escopo nesta fase:

- CRM completo.
- HIS ou prontuario clinico completo.
- Financeiro, billing e marketing.
- Omnichannel completo.
- Mobile app.
- BI avancado.
- Reescrita do Gateway, Secretary ou Evolution API.
- Transportes paralelos de mensagens fora da infraestrutura prevista.

## 3. Estado implementado observado

Superficie principal encontrada:

- `apps/desk-api`: API Fastify principal, health/readiness, Swagger, rate limit, CORS, auth, chat, tasks, notes, alerts, dashboard, audit, admin e modulos extras.
- `apps/desk-web`: frontend React com login, inbox, contacts, kanban, tasks, notes, alerts, sectors, labels, contact-groups, dashboard, admin, audit e settings.
- `apps/message-worker`: worker de eventos e dead-letter.
- `apps/realtime-service`: WebSocket/realtime com autenticacao e revalidacao.
- `modules/chat`, `tasks`, `notes`, `alerts`, `admin`, `audit`, `dashboard`, `secretary-adapter`, `gateway-adapter`.
- Modulos adjacentes: `contacts`, `labels`, `sectors`, `transfers`, `contact-groups`, `kanban`.
- `packages/database`, `auth`, `events`, `shared`, `integrations`, `realtime`.

Leitura: existe produto real e bem avancado, mas a base ainda tem problemas de maturidade de engenharia e confiabilidade de verificacao.

## 4. Verificacoes executadas

| Comando | Resultado | Observacao |
|---|---|---|
| `pnpm run build` | **FAIL** | Turbo detectou ciclo `@cvg/chat` <-> `@cvg/gateway-adapter`. |
| `pnpm run typecheck` | **FAIL** | Task `typecheck` ausente em parte dos projetos. |
| `pnpm run lint` | **FAIL** | Mesmo ciclo `@cvg/chat` <-> `@cvg/gateway-adapter`. |
| `pnpm audit --audit-level moderate` | **FAIL** | 14 vulnerabilidades: 2 high, 11 moderate, 1 low. |
| `pnpm --filter @cvg/tasks test` | **PASS** | 70 testes passaram; coverage total 95.65%. |
| `pnpm --filter @cvg/desk-web test` | **PASS** | 41 testes passaram. |
| `pnpm --filter @cvg/desk-api test` | **FAIL** | 5 falhas, 102 passes, 3 skipped. |
| `pnpm test` | **FAIL** | Falha consolidada em `@cvg/desk-api`; 26 de 27 tasks do Turbo passaram antes da falha. |
| `TEARDOWN=1 pnpm run qa:full-cycle` | **FAIL** | Stress falhou em p95: 431.08ms contra threshold 200ms. |

## 5. Evidencias principais

### 5.1 Dependencia circular bloqueadora

O Turbo falhou em `build` e `lint` por ciclo:

```text
@cvg/chat#build -> @cvg/gateway-adapter#build
@cvg/gateway-adapter#build -> @cvg/chat#build
```

Evidencia:

- `modules/chat/package.json` depende de `@cvg/gateway-adapter`.
- `modules/gateway-adapter/package.json` depende de `@cvg/chat`.

Impacto:

- Build e lint da raiz nao sao confiaveis.
- A separacao Gateway Adapter vs Chat Core fica arquiteturalmente fragil.
- O escopo exige preservar Gateway como integracao, nao acoplar circularmente os dominios.

### 5.2 `typecheck` nao e gate real

`pnpm run typecheck` falhou porque `turbo run typecheck` nao encontra task `typecheck` em todos os pacotes.

Impacto:

- O projeto declara um gate de tipo, mas ele nao executa como qualidade central.
- Erros TypeScript podem passar despercebidos em pacotes sem script.

### 5.3 Testes de API falhando

`@cvg/desk-api` falhou com:

- Testes de rate limit esperando login `200`, mas recebendo `401`.
- Teste de webhook em producao sem `WEBHOOK_SECRET` bloqueado antes por `CORS_ORIGIN` ausente.
- Teste de dashboard KPI tentando inserir role `Admin` duplicada.
- Teste de contacts com divergencia de telefone esperado vs retornado.
- Cleanup de webhook security stats com UUID vazio apos falha de setup.

Impacto:

- A suite de integracao da API esta instavel.
- Alguns testes parecem depender de estado global do banco e ordem de execucao.
- A documentacao de prontidao operacional superestima a confiabilidade atual.

### 5.4 `qa:full-cycle` falhou no stress

Resultado do ciclo:

```text
Total Requests: 37429
Failed Requests (5xx): 0
Error Rate: 0.00%
Checks Rate: 100.00%
p95: 431.08ms
threshold p95: 200ms
SCENARIO: FAILED
```

Impacto:

- A meta operacional do roadmap 96/100 ainda nao foi atingida.
- `scenario_thresholds.scenario_passed` retornou `false`.

### 5.5 Health check com falso positivo operacional

Durante `qa:full-cycle`, o script aceitou HTTP 200 como health ok, mas o payload continha:

```json
{
  "status": "error",
  "checks": {
    "database": { "status": "ok" },
    "redis": { "status": "error", "error": "fetch failed" }
  }
}
```

Impacto:

- O ciclo pode avancar com dependencia degradada.
- A validacao de health precisa analisar payload, nao apenas status HTTP.

### 5.6 Vulnerabilidades de dependencias

`pnpm audit --audit-level moderate` encontrou 14 vulnerabilidades:

- 2 high.
- 11 moderate.
- 1 low.

Principais pacotes envolvidos:

- `fastify`.
- `vite` / `esbuild` / `postcss`.
- `follow-redirects` via `axios`.
- `@fastify/static` via `@fastify/swagger-ui`.
- `uuid`.

Impacto:

- Estado atual nao deve ser considerado pronto para producao sem triagem e mitigacao.

### 5.7 Token no frontend em `localStorage`

O frontend persiste token no Zustand persist/localStorage e o cliente API le token diretamente do `localStorage`.

Impacto:

- Risco XSS: token bearer exposto em storage acessivel por JavaScript.
- Para producao, preferir cookie `HttpOnly`, `Secure`, `SameSite` ou uma decisao formal documentada sobre trade-off.

## 6. Notas por item analisado

| Item | Nota | Justificativa |
|---|---:|---|
| Aderencia ao escopo MVP | 84 | Core do MVP existe; modulos extras sao adjacentes, mas precisam de governanca. |
| Direcao de produto | 76 | Direcao correta, mas roadmaps recentes focam score/QA mais que produto operacional. |
| Chat core | 86 | Inbound/outbound e webhook existem; bloqueado por ciclo com gateway-adapter e falhas de suite. |
| Tasks | 95 | 70 testes passaram; coverage total 95.65%. |
| Notes | 78 | Existe modulo e UI, mas evidencia funcional menor que tasks. |
| Alerts | 80 | Existe ack/resolve e alerting; precisa publicar/validar melhor lifecycle e testes profundos. |
| Admin basico | 82 | Existe superficie ampla; precisa estabilizar testes e RBAC granular. |
| Dashboard/KPIs | 72 | Implementado, mas testes KPI estao skipped/falhando por fixture. |
| Audit/observabilidade | 76 | Audit, metrics e dead-letter existem; health e runtime ainda tem falso positivo. |
| Secretary/Gateway integration | 73 | Adapter existe, mas acoplamento circular com chat prejudica arquitetura. |
| Realtime | 84 | Testes comportamentais fortes; manter remocao gradual de token em URL. |
| Arquitetura modular | 68 | Boa estrutura, mas dependencia circular bloqueia gates centrais. |
| Build | 45 | `pnpm run build` falha. |
| Typecheck | 40 | Script raiz existe, mas nao roda em todos os pacotes. |
| Lint | 45 | `pnpm run lint` falha por ciclo. |
| Testes | 70 | Muitas suites passam, mas `desk-api` e raiz falham. |
| Coverage | 78 | Tasks excelente; cobertura global nao comprovada. |
| Seguranca | 62 | Audit com vulnerabilidades e token em localStorage. |
| Runtime/QA full-cycle | 55 | `qa:full-cycle` falha em p95 e health valida apenas HTTP 200. |
| Documentacao | 78 | Rica, mas relatatorios recentes superestimam maturidade atual. |
| Prontidao para producao | 58 | Gates vermelhos impedem classificacao enterprise-ready. |

## 7. Diagnostico final

O projeto esta dentro da direcao correta e possui uma base funcional relevante. No entanto, o estado atual deve ser tratado como **76/100**, nao como 96/100.

Para voltar a perseguir 96/100 com evidencia real, o foco deve ser:

1. Corrigir o ciclo `@cvg/chat` <-> `@cvg/gateway-adapter`.
2. Tornar `build`, `lint` e `typecheck` gates reais.
3. Estabilizar `@cvg/desk-api` e `pnpm test`.
4. Corrigir vulnerabilidades de dependencias.
5. Corrigir `qa:full-cycle` para validar payload de health.
6. Otimizar p95 ou ajustar threshold apenas se houver decisao documentada.
7. Formalizar se modulos extras sao escopo atual ou backlog futuro.

## 8. Recomendacao de direcao

Nao ampliar features agora.

A direcao recomendada e uma fase de **reconciliacao e hardening**:

- primeiro fechar qualidade de engenharia;
- depois estabilizar verificacao operacional;
- por fim atualizar a documentacao de score com base em evidencia nova.

Enquanto `qa:full-cycle`, `build`, `lint`, `typecheck`, `test` e `audit` falharem, qualquer score acima de 85 deve ser considerado aspiracional.
