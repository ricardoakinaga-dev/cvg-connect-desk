# Roadmap — CVG Connect Desk

## 1. Objetivo
Definir o plano de execução do **CVG Connect Desk** de forma:
- incremental;
- segura;
- coerente com a arquitetura definida;
- alinhada com o estado real do repositório.

Este documento estabelece:
- fases de construção;
- ordem obrigatória de execução;
- dependências reais;
- critérios de entrada e saída por fase;
- regras para evitar implementação fora de ordem.

## 2. Estado Atual do Projeto

> **Nota de leitura:** Revisado em 2026-04-09. "Fase concluída" significa que a estrutura foi construída, não necessariamente que está em produção sem gaps. Verificar seção de pendências.

No momento atual:
- a documentação arquitetural está avançada e endurecida;
- o monorepo está estruturado com `apps`, `modules` e `packages`;
- as fases 0, 1, 2, 3, 4, 5 e 7 já materializaram: backend API, chat, tasks, notes, alerts, events, worker, realtime, dashboard e frontend MVP;
- existe pipeline assíncrono com worker implementado (apps/message-worker);
- existe realtime-service implementado (apps/realtime-service) **e conectado ao frontend**;
- existe frontend operacional (apps/desk-web) com Inbox 3 colunas, Tasks, Alerts, Dashboard;
- IAM, Chat Core, Operations já possuem modelagem concreta no banco;
- existe integração com Secretary via modules/secretary-adapter (integrada ao fluxo inbound);
- autenticação real implementada com login, logout, sessões e RBAC;
- existe módulo de audit trail implementado;
- rate limiting implementado via @fastify/rate-limit.

**Conclusão:**
- o projeto já possui backend funcional e frontend MVP operacional com hardening;
- autenticação real, RBAC e auditoria estão implementados;
- realtime e Secretary estão integrados ao fluxo;
- ainda há gaps técnicos de produção (ver pendências abaixo).

### Pendências Técnicas Conhecidas (Gaps de Produção)

> Estas não bloqueiam operação, mas são limitações para escala e segurança:

| Gap | Descrição | Impacto |
|-----|-----------|---------|
| Cobertura de testes | A esteira já evoluiu bastante, mas ainda não cobre a profundidade enterprise total | Risco residual de regressão |
| Runtime/deploy | Setup local e CI estão maduros, mas produção ainda tem arestas operacionais | Prontidão premium parcial |
| Observabilidade/KPIs | Dashboard e auditoria existem, mas ainda faltam métricas e diagnósticos mais profundos | Visão gerencial/operacional ainda incompleta |

**Nota:** os gaps antigos de pipeline in-memory, realtime desconectado, auth realtime fraca e webhook sem fail-secure já foram mitigados no código. Para a fotografia mais atual, consultar `docs/GAPS-TECNICOS.md` e `docs/60-relatorio-consolidado-estado-construcao-cvg-connect-desk.md`.

## 3. Princípios do Roadmap

### 3.1 Ordem É Obrigatória
As fases devem ser executadas na ordem definida.

Quebrar a ordem aumenta risco de retrabalho, acoplamento errado e refactor destrutivo.

### 3.2 Não Pular Fundação
Não implementar:
- UI completa;
- realtime avançado;
- analytics;

antes da base estar sólida.

### 3.3 Persistência Antes de Automação
Primeiro:
- persistir corretamente.

Depois:
- automatizar;
- reagir;
- otimizar.

### 3.4 API Antes de Worker
- estado nasce na API;
- worker reage;
- realtime projeta.

### 3.5 Evitar Over-Engineering Precoce
- sem microserviço desnecessário;
- sem pipeline complexo antes da necessidade;
- sem otimização prematura.

## 4. Visão Geral das Fases

```text
Phase 0 -> Foundation                  [CONCLUÍDA]
Phase 1 -> Core Chat                   [CONCLUÍDA]
Phase 2 -> Operations (Tasks/Notes)     [CONCLUÍDA]
Phase 3 -> Integrations + Secretary    [CONCLUÍDA]
Phase 4 -> Realtime                    [CONCLUÍDA]
Phase 5 -> Dashboard + Observability   [CONCLUÍDA]
Phase 6 -> Frontend MVP                [CONCLUÍDA]
Phase 7 -> Hardening + Production      [CONCLUÍDA]
Phase 8 -> Refinement & Deployment     [CONCLUÍDA]
```

## 5. Phase 0 — Foundation

### Objetivo
Criar base técnica mínima consistente para o restante do sistema.

### Inclui
- estrutura de pacotes e módulos;
- configuração de banco;
- migrations iniciais;
- evolução controlada de IAM;
- setup auth básico sem fluxo completo;
- configuração base da API;
- contratos internos iniciais de persistência.

### Não Inclui
- chat funcional;
- integrações externas operacionais;
- realtime;
- dashboard.

### Critério de Entrada
- documentação base aprovada;
- data model inicial definido;
- arquitetura de backend e segurança já endurecidas.

### Critério de Saída
- API sobe;
- banco conecta;
- migrations executam;
- estrutura de módulos está consistente;
- base de IAM evolui sem quebrar o schema inicial já existente.

## 6. Phase 1 — Core Chat

### Objetivo
Implementar o núcleo de conversa e mensagem.

### Inclui
- `conversations`;
- `messages`;
- inbound via webhook;
- persistência de mensagens;
- outbound básico;
- assignment inicial;
- status de conversa.

### Não Inclui
- tasks;
- alerts derivados complexos;
- dashboard;
- IA avançada.

### Dependências
- Phase 0 completa.

### Critério de Entrada
- banco, migrations e estrutura de módulos prontos;
- base mínima de auth e API disponível;
- contratos de integração e data model aprovados.

### Critério de Saída
- mensagem inbound entra e é persistida;
- mensagem outbound sai com rastreabilidade básica;
- conversa possui lifecycle mínimo;
- assignment e status deixam estado atual e histórico coerentes.

## 7. Phase 2 — Operations

### Objetivo
Adicionar operação interna acima do chat.

### Inclui
- tasks;
- notes;
- alerts básicos;
- vínculo com conversa, tutor e patient.

### Não Inclui
- automação complexa;
- analytics avançado;
- materialização de métricas.

### Dependências
- Phase 1 completa.

### Critério de Entrada
- chat persistido e estável;
- modelo de contexto operacional disponível;
- trilha mínima de estado atual e histórico já confiável.

### Critério de Saída
- tasks funcionam;
- notes operacionais estão disponíveis;
- alerts básicos funcionam;
- operação interna consegue atuar sobre conversa e contexto associado.

## 8. Phase 3 — Integrations + Secretary

### Objetivo
Integrar IA e automação controlada sem quebrar o core.

### Inclui
- `secretary-adapter`;
- handoff bot ↔ humano;
- chamadas controladas para IA;
- fallback seguro;
- eventos básicos ligados à invocação da Secretary.

### Não Inclui
- autonomia irrestrita;
- decisões críticas sem controle;
- expansão para HIS ou CRM completo.

### Dependências
- Phase 1 completa;
- Phase 2 completa;
- eventos básicos já disponíveis ou prontos para serem introduzidos sem inverter dependência.

### Critério de Entrada
- core de chat estável;
- operação interna já persistida;
- contratos de integração e segurança de fronteira definidos.

### Critério de Saída
- IA integrada por adapter dedicado;
- handoff rastreável;
- fallback operacional definido;
- integração não contamina o core com payload cru.

## 9. Phase 4 — Realtime

### Objetivo
Atualizar a UI em tempo real a partir de estado já aceito pelo backend.

### Inclui
- `realtime-service` como runtime ou papel operacional equivalente;
- eventos internos -> frontend;
- atualização de inbox;
- atualização de conversa;
- reconciliação incremental na UI.

### Não Inclui
- lógica de negócio no realtime;
- bootstrap de estado pelo canal realtime;
- cálculo de KPI no frontend.

### Dependências
- eventos estruturados;
- persistência estável do core;
- Phase 1 completa no mínimo;
- preferencialmente Phase 2 completa para que projeções relevantes já existam.

### Critério de Entrada
- envelope de eventos definido;
- papéis entre API, worker e realtime claros;
- frontend preparado para consumir projeção sem virar fonte da verdade.

### Critério de Saída
- UI reflete eventos em tempo real;
- reconnect e revalidação não quebram a consistência;
- realtime continua sendo apenas projeção.

## 10. Phase 5 — Dashboard + Observability

### Objetivo
Dar visibilidade operacional e gerencial confiável.

### Inclui
- KPIs definidos;
- queries agregadas;
- logs estruturados;
- audit logs;
- health e readiness;
- troubleshooting mínimo viável;
- alertas operacionais básicos.

### Não Inclui
- BI avançado;
- machine learning;
- analytics analítico fora do escopo atual.

### Dependências
- data model estável o suficiente para agregação;
- eventos consistentes;
- flows principais já persistidos;
- critérios de audit e observabilidade já definidos.

### Critério de Entrada
- chat e operações já geram estado confiável;
- eventos e correlação mínima estão definidos;
- KPIs já têm fonte e fórmula explícitas.

### Critério de Saída
- métricas confiáveis;
- troubleshooting mínimo possível;
- health e readiness deixam o serviço operável;
- logs e audit diferenciam claramente governança de diagnóstico técnico.

## 11. Phase 6 — Hardening + Production Readiness

### Objetivo
Preparar o sistema para produção real.

### Inclui
- segurança endurecida;
- rate limiting;
- retry controlado;
- observabilidade mais madura;
- performance tuning;
- políticas de fallback revisadas;
- readiness operacional para produção.

### Dependências
- todas as fases anteriores.

### Critério de Entrada
- core funcional;
- integrações controladas;
- realtime e dashboard mínimos estáveis;
- segurança, audit e observabilidade já presentes em nível básico.

### Critério de Saída
- sistema estável;
- auditável;
- observável;
- operável em produção.

## 12. Dependências Críticas

### 12.1 Ordem Obrigatória
- data model -> backend -> events -> realtime -> dashboard.

### 12.2 Relações-Chave
- `messages` depende de `conversations`;
- tasks dependem de `conversation`, `tutor` ou `patient`;
- alerts dependem de eventos e estado operacional já persistido;
- dashboard depende de dados persistidos, definições de KPI e observabilidade mínima;
- worker depende de API e persistência prévias;
- realtime depende de eventos e contratos internos consistentes;
- frontend operacional depende de backend e contratos estáveis.

## 13. O Que Não Fazer
- construir UI completa antes da API;
- criar eventos sem persistência;
- usar realtime como fonte de verdade;
- integrar IA antes do core estar estável;
- criar dashboard sem definição de KPI;
- criar tabela sem domínio claro;
- introduzir worker antes de existir estado primário bem definido na API.

## 14. Critérios de Qualidade por Fase
Cada fase deve:
- não quebrar a anterior;
- ser testável isoladamente;
- ter comportamento observável;
- ter logs mínimos;
- ter fallback seguro;
- preservar coerência com os documentos já endurecidos.

## 15. Regra de Execução
Antes de iniciar qualquer fase, é obrigatório:
- verificar dependências;
- validar documentos anteriores;
- confirmar ausência de conflito estrutural;
- evitar implementar fora da fase atual.

Se uma fase exigir componente ainda inexistente em fase anterior:
- a dependência deve ser resolvida antes;
- ou o roadmap deve ser atualizado explicitamente;
- nunca deve ser resolvida por atalho ad hoc.

## 16. Regra de Precedência
Este documento orienta:
- ordem de implementação;
- dependências;
- sequência de desenvolvimento.

Se houver conflito entre execução e este roadmap:
- corrigir a execução;
- ou atualizar o roadmap explicitamente antes de prosseguir.
