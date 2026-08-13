# Meta Documentação — CVG Connect Desk

> **Atualização de precedência — 2026-08-12:** para decisão e execução, use 91-relatorio-auditoria-atual-74.md, 92-plano-executivo-95-todos-itens.md, 93-roadmap-95-todos-itens.md e 94-backlog-95-todos-itens.md. A entrega comprovada está em 95-relatorio-entrega-plano-95.md, o scorecard executável em 95-scorecard.json e o runbook em 96-runbook-release-operacao.md. Os documentos anteriores de 98/100 são históricos e não substituem a linha atual.

## 0. Fonte atual de decisão

O baseline verificável desta working tree é **74/100**. A meta aprovada para a próxima fase é **95/100 em cada item**, não apenas uma média geral.

O relatório 91 registra o baseline executado em 2026-08-12. O plano, roadmap e backlog vinculados formam a linha normativa desta fase; o relatório 95 registra a implementação e as evidências dos gates concluídos.

Antes de declarar qualquer score acima do baseline, exigir evidência executada sem cache, em ambiente limpo, com os critérios de saída definidos no plano executivo.

> **Status:** DOCUMENTO DE REFERÊNCIA
> **Atualizado:** 2026-08-12
> **Meta atual:** 95/100 — plano em 92; evidência de entrega em 95.

---

## 1. Visão Geral

A pasta `/docs` contém a documentação do projeto CVG Connect Desk. Esta documentação evoluiu ao longo do tempo e inclui documentos de diferentes naturezas:

- **Estado atual** — o que o código faz hoje
- **Arquitetura e alvo** — direção técnica
- **Roadmap** — fases de implementação
- **Histórico** — auditorias e planos de momentos específicos
- **Análises** — estudos comparativos entre docs e código
- **Planos para 98** — roadmap e backlog para fechamento de qualidade, coverage e performance

**Problema conhecido:** documentos antigos podem conter afirmações que não correspondem mais ao código atual. Este mapa ajuda a identificar qual documento consultar para cada necessidade.

---

## 2. Scorecard Atual

O score 98/100 de 2026-04-28 pertence ao histórico. O baseline de entrada desta fase foi 74/100, com meta de 95/100 por item; a entrega validada está registrada em 95-relatorio-entrega-plano-95.md e 95-scorecard.json.

Evidencias principais:

- `pnpm run test:coverage:critical` PASS com todos os pacotes criticos >= 80%;
- QA full-cycle com `QA_PERF_PROFILE=production` PASS com p95 23.64ms;
- `pnpm run check:security:session` PASS;
- `pnpm audit --audit-level moderate` PASS.

Fonte histórica: `docs/90-relatorio-auditoria-final-98.md`. Fonte atual: `docs/91`–`docs/96` conforme a finalidade.

### Scorecard historico (84/100)

| Frente | Nota | Status |
|--------|------:|--------|
| Fundações (monorepo, banco) | 90 | Forte |
| Core Chat + Operations | 84 | Funcional |
| Infraestrutura (eventos, realtime) | 87 | Forte |
| Interface (frontend, dashboard) | 81 | Funcional |
| Qualidade (testes, CI) | 83 | Em evolução |
| Deploy/Runtime | 78 | Local OK, prod com arestas |

**Historico:** meta antiga 95/100 — ver `docs/72-roadmap-95-porcento.md`.

---

## 3. Como Usar Este Mapa

Para encontrar a informação correta:

1. **Identifique sua necessidade** (ver abaixo)
2. **Consulte a seção correspondente** abaixo
3. **Prefira documentos marcados como "estado atual"**
4. **Evite usar documentos históricos como se fossem atuais**

**Regra prática:** se um documento tem mais de 1 semana e não foi marcado como atualizado, verifique no código antes de tomar decisões.

---

## 4. Documentos de Estado Atual (2026-08-12)

| Documento | O Que Contém | Quando Usar |
|-----------|--------------|-------------|
| 91-relatorio-auditoria-atual-74.md | Baseline executado, scorecard e bloqueadores atuais | Decisão e auditoria |
| 92-plano-executivo-95-todos-itens.md | Metas, gates, owners e frentes para 95/100 | Gestão da recuperação |
| 93-roadmap-95-todos-itens.md | Sequenciamento relativo e marcos de saída | Planejamento da execução |
| 94-backlog-95-todos-itens.md | Tickets, prioridades, critérios de aceite e evidências | Execução técnica |

**Regra:** estes quatro documentos formam a linha atual. Os documentos abaixo registram referências históricas e devem ser conferidos contra o código.

### 4B. Evidência atual da entrega

| Documento | O Que Contém | Quando Usar |
|-----------|--------------|-------------|
| `95-relatorio-entrega-plano-95.md` | Resultado dos gates, notas finais dos 18 itens, 30 IDs e riscos residuais | Decisão de entrega |
| `95-scorecard.json` | Matriz executável com nota, owner, comando, data e evidências | Validar governança da nota |
| `96-runbook-release-operacao.md` | Release, migrations, segredos, DLQ, rollback, SLO e escalonamento | Staging/produção e incidentes |

## 4A. Linha histórica de documentos de estado anterior

Estes documentos registram análises históricas; não devem ser usados sozinhos para afirmar o estado atual do código:

| Documento | O Que Contém | Quando Usar |
|-----------|--------------|-------------|
| `18-deployment-and-runtime.md` | Runtimes, portas, variáveis de ambiente | Setup de ambiente |
| `21-instalacao-local.md` | Guia detalhado de instalação local | Instalação do projeto |
| `26-relatorio-analise-documentacao-vs-implementacao.md` | Análise técnica completa | Entender estado real do projeto |
| `27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md` | Tabela de aderência docs vs código | Verificar se algo está implementado |
| `71-relatorio-documentacao-vs-implementacao.md` | Relatório de gap 84/100 (Abril 2026) | Estado atual consolidado |
| `86-plano-executivo-pos-bloqueios-98.md` | Plano executivo histórico depois dos bloqueios resolvidos | Comparar decisões de abril/2026 |
| `87-roadmap-pos-bloqueios-98.md` | Roadmap histórico para coverage, performance e auditoria final | Comparar sequência anterior |
| `88-backlog-pos-bloqueios-98.md` | Backlog PB98 com itens concluidos | Auditar o fechamento executado |
| `89-politica-dependencias-transitivas.md` | Politica vigente de supply chain e overrides | Revisar dependencias |
| `90-relatorio-auditoria-final-98.md` | Auditoria histórica 98/100 com notas por item | Comparar baseline anterior |

**A tabela acima é referência histórica; para decisão operacional use a seção 4 e os documentos 91–94.**

---

## 5. Documentos de Arquitetura e Alvo

Descrevem a direção técnica e decisões de design:

| Documento | O Que Contém | Status |
|-----------|--------------|--------|
| `04-target-architecture.md` | Arquitetura alvo e componentes de runtime | ✅ Válido |
| `05-domain-model.md` | Modelo de domínio e entidades | ✅ Válido |
| `07-backend-architecture.md` | Estrutura da API e padrões | ✅ Válido |
| `08-frontend-architecture.md` | Estrutura do frontend | ⚠️ Desatualizado (realtime já conectado) |
| `09-data-model.md` | Schema do banco de dados | ✅ Válido |
| `10-realtime-and-events.md` | Arquitetura de eventos e realtime | ✅ Válido |
| `11-security-and-access-control.md` | Modelo de segurança | ✅ Válido |
| `12-audit-and-observability.md` | Audit trail e observabilidade | ✅ Válido |

---

## 6. Documentos históricos para 98/100 (Abril 2026)

### Linha histórica pos-bloqueios

| Documento | O Que Contem |
|-----------|--------------|
| `86-plano-executivo-pos-bloqueios-98.md` | Plano executivo executado: bloqueios, coverage e performance encerrados |
| `87-roadmap-pos-bloqueios-98.md` | Roadmap executado para chegar a 98/100 |
| `88-backlog-pos-bloqueios-98.md` | Backlog PB98 executado |
| `89-politica-dependencias-transitivas.md` | Politica de dependencias transitivas |
| `90-relatorio-auditoria-final-98.md` | Relatorio final de auditoria 98/100 |

### Linha anterior / baseline

| Documento | O Que Contem |
|-----------|--------------|
| `82-plano-executivo-98-todos-itens.md` | Plano anterior para elevar todos os itens a 98/100 |
| `83-roadmap-98-todos-itens.md` | Roadmap anterior antes da remocao dos bloqueios |
| `84-backlog-98-todos-itens.md` | Backlog anterior B98 |
| `85-baseline-governanca-score-98.md` | Baseline anterior que identificou os bloqueios ja tratados |

### Linha historica 95/100

| Documento | O Que Contém |
|-----------|--------------|
| `71-relatorio-documentacao-vs-implementacao.md` | Relatório de gap doc vs código (84/100) |
| `72-roadmap-95-porcento.md` | Roadmap para elevação 84→95/100 |
| `73-backlog-95-porcento.md` | Backlog detalhado com critérios de aceitação |

---

## 7. Documentos de Operação e Setup

Guia prático para operação:

| Documento | O Que Contém |
|-----------|--------------|
| `95-relatorio-entrega-plano-95.md` | Entrega atual do plano 95 e evidências executadas |
| `95-scorecard.json` | Scorecard atual validável por `pnpm run verify:scorecard` |
| `96-runbook-release-operacao.md` | Runbook atual de release e operação |
| `18-deployment-and-runtime.md` | Runtimes, portas, health checks |
| `21-instalacao-local.md` | Instalação e configuração local |
| `16-validation-checklist.md` | Checklist de validação operacional (8/15 ✓) |

---

## 8. Documentos de Roadmap e Fases

Trilha de implementação:

| Documento | O Que Contém | Status |
|-----------|--------------|--------|
| `14-roadmap.md` | Fases de implementação e dependências | ⚠️ Parcialmente desatualizado |
| `15-implementation-phases.md` | Detalhamento das fases | ⚠️ Parcialmente desatualizado |
| `22-enterprise-premium-plan.md` | Plano enterprise (aspiracional) | ⚠️ Aspiracional |
| `61-plano-executivo-restante-enterprise-premium.md` | Plano restante enterprise | ⚠️ Parcialmente válido |

---

## 9. Documentos Históricos (Não São Estado Atual)

Estes documentos são fotografias de momentos específicos e **podem conter informações desatualizadas**:

| Documento | Data | Motivo |
|-----------|------|--------|
| `23-auditoria-executiva.md` | 09/04/2026 | Afirmações sobre realtime, Secretary e testes que já foram resolvidos |
| `AUDITORIA_IMPLEMENTACAO.md` | 30/03/2026 | Auditoria antiga com muitas claims agora incorretas |
| `20-master-execution-log.md` | Histórico | Registro de evolução por fases |

**Antes de usar um documento histórico, verificar se ele foi marcado como histórico no cabeçalho.**

---

## 10. Relatórios Analíticos

Análises comparativas entre docs e código:

| Documento | O Que Contém |
|-----------|--------------|
| `26-relatorio-analise-documentacao-vs-implementacao.md` | Análise técnica completa |
| `27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md` | Tabela executiva de aderência |
| `60-relatorio-consolidado-estado-construcao-cvg-connect-desk.md` | Estado consolidado (90/100) |
| `71-relatorio-documentacao-vs-implementacao.md` | Relatório de gap 84/100 |

---

## 11. Ordem Recomendada de Leitura

Para novos colaboradores:

1. **Primeiro:** `README.md` (raiz) — visão geral
2. **Segundo:** `21-instalacao-local.md` — como setup local
3. **Terceiro:** `04-target-architecture.md` — arquitetura
4. **Quarto:** `91-relatorio-auditoria-atual-74.md` — baseline e riscos atuais
5. **Quinto:** `92-plano-executivo-95-todos-itens.md` e `93-roadmap-95-todos-itens.md` — execução da recuperação
6. **Sexto:** `94-backlog-95-todos-itens.md` — tickets e critérios de aceite

Para verificar se algo está implementado:
1. Consultar `91-relatorio-auditoria-atual-74.md`
2. Verificar no código

---

## 12. Gaps registrados nos documentos históricos Pos-98

Os bloqueios listados abaixo foram classificados como fechados nos documentos de abril de 2026. A auditoria atual de 2026-08-12 reabriu riscos que não foram comprovados no ambiente atual:

| Gap | Descrição | Impacto | Prioridade |
|-----|-----------|---------|------------|
| Branch/function coverage frontend | Alguns arquivos ainda podem melhorar branch/function coverage | Sustentacao | P2 |
| Tempo do CI completo | `ci:gates` pode ficar pesado conforme suite cresce | Devex | P2 |
| Performance em staging/prod | QA passou em compose local otimizado; repetir por release | Operacao | P1 |
| Documentos historicos | Podem conter claims antigas | Governanca | P2 |

**Fonte histórica:** `docs/90-relatorio-auditoria-final-98.md`. A fonte atual é 91-relatorio-auditoria-atual-74.md.

---

## 13. Regras de Manutenção Documental

Para manter a documentação confiável:

1. **Ao fazer uma mudança significativa no código:**
   - Atualizar `18-deployment-and-runtime.md` se mudou portas ou runtimes
   - Atualizar `71-relatorio-documentacao-vs-implementacao.md` se mudou funcionalidades

2. **Ao criar novo documento:**
   - Adicionar header com data e status
   - Marcar se é "estado atual", "histórico" ou "alvo futuro"

3. **Ao editar documento histórico:**
   - Manter o original
   - Adicionar nota de atualização no cabeçalho
   - Não apagar o conteúdo histórico

4. **Se houver duvida se um documento esta atual:**
   - Verificar data no cabeçalho
   - Consultar `71-relatorio-documentacao-vs-implementacao.md`
   - Validar no código

---

## 14. Referência Rápida

| Necessidade | Consultar |
|------------|-----------|
| Como instalar | `21-instalacao-local.md` |
| Como o sistema funciona | `04-target-architecture.md` |
| Quais portas usar | `18-deployment-and-runtime.md` |
| Está implementado? | `71-relatorio-documentacao-vs-implementacao.md` |
| O que foi entregue | `95-relatorio-entrega-plano-95.md` |
| Como operar/promover | `96-runbook-release-operacao.md` |
| O que falta fazer agora | `95-relatorio-entrega-plano-95.md` — seção de riscos residuais e próximo gate |
| Setup de testes | `25-plano-testes-completo.md` |
| Validar operacionalmente | `16-validation-checklist.md` |

---

## 15. Status dos Documentos (Legenda)

| Status | Significado |
|--------|-------------|
| ✅ Válido | Documento reflete o estado atual do código |
| ⚠️ Desatualizado | Documento precisa de atualização para refletir estado atual |
| ⚠️ Parcial | Documento parcialmente implementado |
| ❌ Obsoleto | Documento não representa mais o estado do sistema |

---

**Última atualização:** 2026-08-12
**Próxima revisão:** antes da promoção para staging/produção ou se qualquer gate crítico regredir.
