# Backlog para 98/100 em Todos os Itens

**Data:** 2026-04-28  
**Relatorio base:** `docs/81-relatorio-auditoria-pos-hardening-warnings-vite.md`  
**Plano executivo:** `docs/82-plano-executivo-98-todos-itens.md`  
**Roadmap:** `docs/83-roadmap-98-todos-itens.md`

## Convencoes

| Prioridade | Significado |
|---|---|
| P0 | Bloqueia qualquer declaracao de 98/100 ou prontidao de producao |
| P1 | Necessario para robustez, governanca ou manutencao do score |
| P2 | Acabamento, automacao ou reducao de risco operacional |

## P0 - Baseline e governanca do score

### B98-01 - Criar matriz de scoring 98 por item

**Status:** pendente  
**Area:** auditoria/documentacao  
**Impacto esperado:** Escopo 96 -> 98, Direcao 96 -> 98, Documentacao 94 -> 96.

#### Tarefas

- Copiar todos os itens analisados no relatorio 81 para uma matriz de acompanhamento.
- Definir criterio objetivo de 98 para cada item.
- Vincular cada criterio a comando, teste, evidencia ou documento.
- Marcar itens que ja estao em 98+ como manutencao.

#### Criterios de aceite

- Matriz salva em `docs/` ou incorporada ao fechamento final.
- Nenhuma nota e elevada sem evidencia.
- Todos os itens abaixo de 98 possuem backlog vinculado.

### B98-02 - Reexecutar baseline tecnico atual

**Status:** pendente  
**Area:** QA/devex  
**Impacto esperado:** Documentacao 94 -> 96.

#### Tarefas

- Executar `pnpm run lint`.
- Executar `pnpm run build`.
- Executar `pnpm run typecheck`.
- Executar `pnpm run test`.
- Executar `pnpm run test:coverage:critical`.
- Executar `pnpm audit --audit-level moderate`.
- Registrar resultados e lacunas.

#### Criterios de aceite

- Todos os resultados documentados.
- Falhas ou quedas de coverage viram itens P0.

## P0 - Coverage e testes criticos

### B98-03 - Elevar coverage de `@cvg/desk-web` para minimo aprovado

**Status:** pendente  
**Area:** frontend/testes  
**Impacto esperado:** Coverage 82 -> 90, Notes 88 -> 94, Dashboard 90 -> 94, Testes 97 -> 98.

#### Tarefas

- Cobrir Login e logout.
- Cobrir Inbox/chat com estados de sucesso, vazio e erro.
- Cobrir Notes: criar, listar, erro e permissao.
- Cobrir Alerts: listar, filtro, ack/read e erro.
- Cobrir Dashboard: KPIs operacionais, loading, vazio e erro.
- Cobrir Admin/RBAC basico.

#### Criterios de aceite

- `pnpm --filter @cvg/desk-web test` passa.
- Coverage statements do pacote atinge meta definida no gate critico.
- Testes nao dependem de ordem global ou estado persistente.

### B98-04 - Elevar coverage de `@cvg/desk-api` para >= 80%

**Status:** pendente  
**Area:** backend/testes  
**Impacto esperado:** Coverage 90 -> 94, Prontidao producao 91 -> 93.

#### Tarefas

- Cobrir rotas principais com sucesso e erro.
- Cobrir auth, rate limit e RBAC.
- Cobrir webhook HMAC e cenarios fail-secure.
- Cobrir health/readiness por ambiente.
- Cobrir respostas padronizadas e validacao de input.

#### Criterios de aceite

- `pnpm --filter @cvg/desk-api test` passa.
- `@cvg/desk-api` statements >= 80%.
- Nenhum skip sem justificativa e prazo.

### B98-05 - Elevar coverage de `@cvg/chat` para >= 80%

**Status:** pendente  
**Area:** chat/testes  
**Impacto esperado:** Chat 95 -> 98, Coverage 94 -> 96.

#### Tarefas

- Cobrir controllers HTTP.
- Cobrir use cases de envio, recebimento, atribuicao e encerramento.
- Cobrir contratos com gateway sem acoplamento concreto.
- Cobrir erros de validacao e autorizacao.

#### Criterios de aceite

- `@cvg/chat` statements >= 80%.
- Fluxos de inbox/chat possuem testes de contrato.

### B98-06 - Elevar coverage de `@cvg/events` para >= 80%

**Status:** pendente  
**Area:** events/testes  
**Impacto esperado:** Gateway/integracao 92 -> 95, Coverage 96 -> 98.

#### Tarefas

- Cobrir eventos tipados.
- Cobrir outbox.
- Cobrir dead-letter.
- Cobrir idempotencia.
- Cobrir falha e retry.

#### Criterios de aceite

- `@cvg/events` statements >= 80%.
- Testes validam contratos de payload.

### B98-07 - Transformar coverage critico em gate permanente

**Status:** pendente  
**Area:** QA/CI  
**Impacto esperado:** Coverage 98 sustentado.

#### Tarefas

- Ajustar thresholds por pacote critico.
- Falhar comando quando pacote ficar abaixo do minimo.
- Documentar exclusoes permitidas.
- Integrar ao CI.

#### Criterios de aceite

- `pnpm run test:coverage:critical` falha em regressao real.
- Todos os pacotes criticos ficam >= 80% statements ou excecao temporaria aprovada.

## P0 - Seguranca de sessao

### B98-08 - Migrar sessao web para cookie HttpOnly

**Status:** pendente  
**Area:** auth/security/frontend/backend  
**Impacto esperado:** Seguranca 91 -> 96, Admin/RBAC 92 -> 96, Prontidao producao 91 -> 95.

#### Tarefas

- Atualizar login para emitir cookie `HttpOnly`.
- Usar `Secure` em producao.
- Definir `SameSite=Lax` ou `SameSite=Strict`.
- Atualizar API client para envio de credenciais.
- Remover persistencia de token de sessao em `localStorage`/`sessionStorage`.
- Atualizar logout para revogar sessao e expirar cookie.

#### Criterios de aceite

- Busca por token em storage nao encontra persistencia de sessao web.
- Login/logout cobertos por testes.
- Regressao de CORS documentada e testada.

### B98-09 - Implementar protecao CSRF para mutacoes autenticadas por cookie

**Status:** pendente  
**Area:** security/backend/frontend  
**Impacto esperado:** Seguranca 96 -> 98, Prontidao producao 95 -> 96.

#### Tarefas

- Escolher estrategia CSRF compativel com o frontend.
- Exigir token/header CSRF em requests mutaveis.
- Permitir safe methods sem token quando apropriado.
- Padronizar erro de CSRF.
























#### Criterios de aceite

- Teste sem CSRF falha.
- Teste com CSRF invalido falha.
  m,./;- Teste com CSRF valido passa.
- Nenhum erro vaza detalhe sensivel.

### B98-10 - Atualizar realtime para fluxo principal sem token persistido

**Status:** pendente  
**Area:** realtime/security  
**Impacto esperado:** Realtime 94 -> 98, Seguranca 98 sustentado.

#### Tarefas

- Definir cookie no handshake ou ticket efemero.
- Implementar emissao e validacao de ticket se cookie nao for suficiente.
- Remover token em URL do fluxo principal.
- Manter legado apenas com flag, log e prazo de remocao.

#### Criterios de aceite

- Testes de autenticacao realtime passam sem token persistido.
- Token legado nao e necessario para fluxo principal.
- Revalidacao e expiracao continuam funcionando.

## P0 - Typecheck completo

### B98-11 - Mapear pacotes sem typecheck real

**Status:** pendente  
**Area:** TypeScript/devex  
**Impacto esperado:** Typecheck 92 -> 94.

#### Tarefas

- Listar todos os workspaces.
- Identificar scripts `typecheck`.
- Identificar uso de `verify-package-source`.
- Classificar pacotes runtime, test-only e tooling.

#### Criterios de aceite

- Matriz de typecheck documentada.
- Pacotes runtime sem `tsc --noEmit` viram itens de correcao.

### B98-12 - Adicionar typecheck real em todos os pacotes runtime

**Status:** pendente  
**Area:** TypeScript  
**Impacto esperado:** Typecheck 94 -> 98, Arquitetura modular 92 -> 96.

#### Tarefas

- Criar ou ajustar `tsconfig.json` por pacote.
- Adicionar script `typecheck`.
- Corrigir erros de tipo encontrados.
- Atualizar `turbo.json` se necessario.

#### Criterios de aceite

- `pnpm run typecheck` cobre todos os pacotes runtime.
- Falhas de tipo bloqueiam o gate.

### B98-13 - Substituir validacoes parciais remanescentes

**Status:** pendente  
**Area:** arquitetura/devex  
**Impacto esperado:** Arquitetura modular 96 -> 98, Prontidao producao 96 -> 97.

#### Tarefas

- Remover `verify-package-source` de pacotes que ja suportam typecheck.
- Manter excecao apenas para tooling sem runtime.
- Documentar prazo para qualquer excecao.

#### Criterios de aceite

- Nenhum pacote runtime depende apenas de validacao parcial.
- Excecoes tem owner e data de revisao.

## P0 - Performance e QA production-profile

### B98-14 - Definir ambiente equivalente a producao

**Status:** pendente  
**Area:** infraestrutura/QA  
**Impacto esperado:** Performance 94 -> 95, Prontidao producao 97 -> 98.

#### Tarefas

- Documentar CPU/memoria, banco, Redis, workers e variaveis.
- Definir massa de dados minima.
- Definir seed/cleanup idempotente.
- Validar `/health` e `/readiness`.

#### Criterios de aceite

- Ambiente reproduzivel documentado.
- Health/readiness estritos passam antes do stress.

### B98-15 - Rodar `qa:full-cycle:archive` com perfil production

**Status:** pendente  
**Area:** QA/performance  
**Impacto esperado:** Performance 95 -> 98.

#### Tarefas

- Executar `QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive`.
- Registrar p95, 5xx, checks e summary.
- Atualizar `docs/qa-full-cycle-log.md`.
- Abrir itens para endpoints lentos se p95 falhar.

#### Criterios de aceite

- `scenario_passed=true`.
- p95 <= 500ms ou SLO formal aprovado.
- 5xx <= 1%.
- checks >= 99%.

### B98-16 - Otimizar endpoints lentos do stress

**Status:** pendente  
**Area:** backend/database/performance  
**Impacto esperado:** Performance 98 sustentado.

#### Tarefas

- Identificar endpoints acima do budget.
- Analisar query plan ou gargalo de auth/cache.
- Adicionar indices ou reduzir N+1 quando confirmado.
- Reexecutar stress.

#### Criterios de aceite

- Endpoints criticos dentro do budget.
- Sem degradar testes funcionais.

## P1 - Supply chain e deprecacoes transitivas

### B98-17 - Inventariar warnings de instalacao

**Status:** pendente  
**Area:** dependencias  
**Impacto esperado:** Seguranca de dependencias 91 -> 94.

#### Tarefas

- Executar instalacao limpa controlada.
- Registrar warnings de deprecacao.
- Mapear dependencia direta que introduz cada warning.
- Verificar versao corrigida disponivel.

#### Criterios de aceite

- Inventario salvo em documento ou issue interna.
- Cada warning tem decisao: atualizar, substituir, override seguro ou excecao.

### B98-18 - Atualizar ou substituir dependencias com transitive deprecated

**Status:** pendente  
**Area:** dependencias/build  
**Impacto esperado:** Seguranca de dependencias 94 -> 97.

#### Tarefas

- Avaliar `drizzle-kit` e cadeia `@esbuild-kit`.
- Avaliar Vitest/jsdom/glob/whatwg-encoding conforme versoes disponiveis.
- Aplicar upgrade compativel.
- Testar build, test, typecheck e audit.

#### Criterios de aceite

- Warnings eliminados quando houver caminho seguro.
- Se nao houver caminho seguro, excecao formal criada.

### B98-19 - Criar politica de excecao para dependencias transitivas

**Status:** pendente  
**Area:** governanca/security  
**Impacto esperado:** Seguranca de dependencias 97 -> 98, Documentacao 96 -> 97.

#### Tarefas

- Definir template de excecao.
- Exigir owner, prazo, versao afetada, impacto e gatilho de revisao.
- Registrar excecoes atuais, se existirem.

#### Criterios de aceite

- Nenhum warning conhecido fica sem owner/prazo.
- `pnpm audit --audit-level moderate` continua PASS.

## P1 - Escopo, produto e documentacao

### B98-20 - Criar checklist anti-expansao de escopo

**Status:** pendente  
**Area:** produto/governanca  
**Impacto esperado:** Escopo 96 -> 98, Direcao 96 -> 98.

#### Tarefas

- Definir perguntas para separar Desk operacional de CRM/BI/HIS.
- Aplicar checklist a contacts, labels, sectors, transfers, contact-groups e kanban.
- Incluir checklist no backlog de novas features.

#### Criterios de aceite

- Todo item adjacente tem justificativa operacional.
- Nenhum item abre funil comercial, BI avancado ou gestao clinica.

### B98-21 - Documentar runbook de evidencia e readiness

**Status:** pendente  
**Area:** observabilidade/operacao  
**Impacto esperado:** Auditoria/observabilidade 92 -> 98, Documentacao 97 -> 98.

#### Tarefas

- Definir como coletar logs, summary, coverage e audit.
- Documentar diferenca entre local, local-docker, staging e production.
- Definir quando `degraded` bloqueia release.

#### Criterios de aceite

- Runbook salvo em `docs/`.
- QA final referencia o runbook.

### B98-22 - Atualizar documentos de score e criar auditoria final 98

**Status:** pendente  
**Area:** documentacao/auditoria  
**Impacto esperado:** Documentacao 98, score geral 98+.

#### Tarefas

- Atualizar documentos impactados pelo novo ciclo.
- Atualizar `docs/qa-full-cycle-log.md`.
- Criar novo relatorio de auditoria com nota por item.
- Marcar documentos antigos como historicos quando necessario.

#### Criterios de aceite

- Todos os itens do relatorio 81 aparecem com nota >= 98.
- Score geral minimo 98/100.
- Relatorio referencia evidencias executadas, nao estimativas.

## P2 - Sustentacao do 98

### B98-23 - Automatizar verificacao de notas/gates antes de release

**Status:** pendente  
**Area:** release/QA  
**Impacto esperado:** Sustentacao do score 98.

#### Tarefas

- Criar script ou checklist de release.
- Verificar comandos obrigatorios.
- Verificar existencia do QA archive mais recente.
- Verificar coverage e audit.

#### Criterios de aceite

- Release nao e declarado sem checklist completo.

### B98-24 - Criar rotina periodica de upgrade e audit

**Status:** pendente  
**Area:** manutencao/security  
**Impacto esperado:** Sustentacao de seguranca 98.

#### Tarefas

- Definir frequencia de revisao de dependencias.
- Registrar responsavel.
- Rodar audit e install warnings periodicamente.

#### Criterios de aceite

- Dependencias nao voltam a acumular risco invisivel.

## Ordem de execucao recomendada

1. B98-01 e B98-02.
2. B98-03 a B98-07.
3. B98-08 a B98-10.
4. B98-11 a B98-13.
5. B98-14 a B98-16.
6. B98-17 a B98-19.
7. B98-20 a B98-22.
8. B98-23 e B98-24.

## Gates finais

```bash
pnpm run lint
pnpm run build
pnpm run typecheck
pnpm run test
pnpm run test:coverage:critical
pnpm --filter @cvg/desk-web build
pnpm --filter @cvg/desk-web test
pnpm audit --audit-level moderate
QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive
```

Todos precisam passar antes de declarar todos os itens em 98/100.
