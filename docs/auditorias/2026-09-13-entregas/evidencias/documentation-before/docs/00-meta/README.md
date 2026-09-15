# Mapa da Documentação — CVG Connect Desk

> **Status:** DOCUMENTO DE REFERÊNCIA
> **Atualizado:** 2026-04-09

**Referência atual de planejamento — 13/09/2026:** [auditoria preservada](../auditorias/2026-09-13/RELATORIO.md) e [plano executivo, roadmap e backlog de produção](../producao-2026-09-13/README.md). Execução planejada; prontidão ainda depende das evidências exigidas.

**Histórico — auditoria e plano de melhoria de 12/09/2026:** consulte o [relatório com notas e evidências](../auditorias/2026-09-12/RELATORIO.md) e o [programa executivo com roadmap e backlog multiagente](../execucao-aaa-2026-09-12/README.md). Esses artefatos registram o estado observado na revisão indicada; afirmações de certificação e de estado atual nos documentos antigos abaixo precisam ser revalidadas. As melhorias do novo backlog estão planejadas, não implementadas.


---

## 1. Visão Geral

A pasta `/docs` contém a documentação do projeto CVG Connect Desk. Esta documentação evoluiu ao longo do tempo e inclui documentos de diferentes naturezas:

- **Estado atual** — o que o código faz hoje
- **Arquitetura e alvo** — direção técnica
- **Roadmap** — fases de implementação
- **Histórico** — auditorias e planos de momentos específicos
- **Análises** — estudos comparativos entre docs e código

**Problema conhecido:** documentos antigos podem conter afirmações que não correspondem mais ao código atual. Este mapa ajuda a identificar qual documento consultar para cada necessidade.

---

## 2. Como Usar Este Mapa

Para encontrar a informação correta:

1. **Identifique sua necessidade** (ver下文)
2. **Consulte a seção correspondente** abaixo
3. **Prefira documentos marcados como "estado atual"**
4. **Evite usar documentos históricos como se fossem atuais**

**Regra prática:** se um documento tem mais de 1 semana e não foi marcado como atualizado, verifique no código antes de tomar decisões.

---

## 3. Documentos de Estado Atual (Confiáveis)

Estes documentos refletem o estado real do código:

| Documento | O Que Contém | Quando Usar |
|-----------|--------------|-------------|
| `18-deployment-and-runtime.md` | Runtimes, portas, variáveis de ambiente | Setup de ambiente |
| `21-instalacao-local.md` | Guia detalhado de instalação local | Instalação do projeto |
| `26-relatorio-analise-documentacao-vs-implementacao.md` | Análise técnica completa | Entender estado real do projeto |
| `27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md` | Tabela de aderência docs vs código | Verificar se algo está implementado |

**Estes são os documentos mais confiáveis para consulta operacional.**

---

## 4. Documentos de Arquitetura e Alvo

Descrevem a direção técnica e decisões de design:

| Documento | O Que Contém |
|-----------|--------------|
| `04-target-architecture.md` | Arquitetura alvo e componentes de runtime |
| `05-domain-model.md` | Modelo de domínio e entidades |
| `07-backend-architecture.md` | Estrutura da API e padrões |
| `08-frontend-architecture.md` | Estrutura do frontend |
| `09-data-model.md` | Schema do banco de dados |
| `10-realtime-and-events.md` | Arquitetura de eventos e realtime |
| `11-security-and-access-control.md` | Modelo de segurança |
| `12-audit-and-observability.md` | Audit trail e observabilidade |

**Nota:** Alguns pontos destes documentos podem estar mais avançados ou atrás do código. Consultar relatório 27 para verificação.

---

## 5. Documentos de Operação e Setup

Guia prático para operação:

| Documento | O Que Contém |
|-----------|--------------|
| `18-deployment-and-runtime.md` | Runtimes, portas, health checks |
| `21-instalacao-local.md` | Instalação e configuração local |
| `README.md` (raiz) | Visão geral do projeto |

---

## 6. Documentos de Roadmap e Fases

轨迹 de implementação:

| Documento | O Que Contém |
|-----------|--------------|
| `14-roadmap.md` | Fases de implementação e dependências |
| `15-implementation-phases.md` | Detalhamento das fases |
| `22-enterprise-premium-plan.md` | Plano enterprise (parcialmente absorvido pelo código) |

**Atenção:** `14-roadmap.md` foi atualizado em 2026-04-09 com nota sobre gaps técnicos. "Fase concluída" não significa "production-ready sem pendências".

---

## 7. Documentos Históricos (Não São Estado Atual)

Estes documentos são fotografias de momentos específicos e **podem conter informações desatualizadas**:

| Documento | Data | Motivo |
|-----------|------|--------|
| `23-auditoria-executiva.md` | 09/04/2026 | Afirmações sobre realtime, Secretary e testes que já foram resolvidos |
| `AUDITORIA_IMPLEMENTACAO.md` | 30/03/2026 | Auditoria antiga com many claims agora incorretas |
| `20-master-execution-log.md` | Histórico | Registro de evolução por fases |

**Antes de usar um documento histórico, verificar se ele foi marcado como histórico no cabeçalho.**

---

## 8. Relatórios Analíticos

Análises comparativas entre docs e código:

| Documento | O Que Contém |
|-----------|--------------|
| `26-relatorio-analise-documentacao-vs-implementacao.md` | Análise técnica completa |
| `27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md` | Tabela executiva de aderência |
| `24-plano-implementacao-enterprise.md` | Plano enterprise rebaselined |

**Estes são os documentos mais atualizados para verificar estado de implementação.**

---

## 9. Ordem Recomendada de Leitura

Para novos colaboradores:

1. **Primeiro:** `README.md` (raiz) — visão geral
2. **Segundo:** `21-instalacao-local.md` — como setup local
3. **Terceiro:** `04-target-architecture.md` — arquitetura
4. **Quarto:** `14-roadmap.md` — fases e estado atual
5. **Quinto:** `18-deployment-and-runtime.md` — detalhes operacionais

Para verificar se algo está implementado:
1. Consultar `27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md`
2. Verificar no código

---

## 10. Gaps Técnicos Conhecidos

Os seguintes gaps são limitações conhecidas e **não bloqueiam operação**:

| Gap | Descrição | Impacto |
|-----|-----------|---------|
| Pipeline de eventos in-memory | `InMemoryEventPublisher` — não é interprocesso real | Não escala para múltiplas instâncias |
| Autenticação realtime | userId enviado sem validação de sessão | Segurança do canal limitada |
| Webhook HMAC | Opcional quando `WEBHOOK_SECRET` não configurado | Segurança de borda parcial |
| Cobertura de testes | Testes existem, cobertura limitada | Risco de regressão |

---

## 11. Regras de Manutenção Documental

Para manter a documentação confiável:

1. **Ao fazer uma mudança significativa no código:**
   - Atualizar `18-deployment-and-runtime.md` se mudou portas ou runtimes
   - Atualizar relatórios 26/27 se mudou funcionalidades

2. **Ao criar novo documento:**
   - Adicionar header com data e status
   - Marcar se é "estado atual", "histórico" ou "alvo futuro"

3. **Ao editar documento histórico:**
   - Manter o original
   - Adicionar nota de atualização no cabeçalho
   - Não apagar o conteúdo histórico

4. **Se不确定 um documento está atual:**
   - Verificar data no cabeçalho
   - Consultar relatórios 26/27
   - Validar no código

---

## 12. Referência Rápida

| Necessidade | Consultar |
|------------|-----------|
| Como instalar | `21-instalacao-local.md` |
| Como o sistema funciona | `04-target-architecture.md` |
| Quais portas usar | `18-deployment-and-runtime.md` |
| Está implementado? | `27-relatorio-executivo-rastreabilidade-documentacao-vs-codigo.md` |
| O que falta fazer | `14-roadmap.md` + gap técnicos |
| Setup de testes | `25-plano-testes-completo.md` |

---

**Última atualização:** 2026-04-09
**Próxima revisão:** Quando houver mudanças significativas de arquitetura ou implementação
