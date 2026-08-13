# Roadmap para 98/100 em Todos os Itens

**Data:** 2026-04-28  
**Documento base:** `docs/81-relatorio-auditoria-pos-hardening-warnings-vite.md`  
**Plano executivo:** `docs/82-plano-executivo-98-todos-itens.md`

## Objetivo

Executar um ciclo final de hardening para elevar todos os itens auditados para **98/100 ou mais**, com evidencia tecnica executada e sem ampliar o produto para fora do Desk operacional.

## Marco 0: Baseline e contrato de score

**Prioridade:** P0  
**Duracao estimada:** 0.5 dia  
**Objetivo:** fixar a linha de partida antes das mudancas.
**Status:** concluido em 2026-04-28. Evidencia em `docs/85-baseline-governanca-score-98.md`.

Entregas:

- Reexecutar coverage critico e salvar resultado.
- Listar pacotes ainda sem typecheck real.
- Confirmar pontos de uso de `localStorage`/`sessionStorage` para token.
- Registrar warnings de `pnpm install` e origem transitiva.
- Criar checklist de score 98 por item auditado.

Criterios de aceite:

- Baseline salvo em `docs/` ou anexado ao fechamento final.
- Itens abaixo de 98 mapeados para backlog.
- Nenhum item muda de nota sem evidencia nova.

## Sprint 1: Coverage e testes de fluxo critico

**Prioridade:** P0  
**Duracao estimada:** 2-4 dias  
**Objetivo:** elevar coverage critico e reduzir risco de regressao funcional.

### R1.1 Coverage de `@cvg/desk-web`

Direcao:

- Cobrir Login, Inbox, Kanban, Notes, Alerts, Admin e Dashboard.
- Testar estados vazios, erro, loading e permissoes.
- Validar que UI operacional nao vira CRM/BI fora do escopo.

Criterios de aceite:

- `@cvg/desk-web` >= 80% statements ou meta intermediaria formal se arquivos auxiliares forem excluidos com justificativa.
- `pnpm --filter @cvg/desk-web test` passa.
- Fluxos Notes, Alerts e Dashboard sobem para nota 98.

### R1.2 Coverage de API, Chat e Events

Direcao:

- `@cvg/desk-api`: rotas, auth, erros, rate limit, webhook, readiness.
- `@cvg/chat`: controllers, use cases, contratos de gateway.
- `@cvg/events`: eventos tipados, outbox, dead-letter, idempotencia.

Criterios de aceite:

- `@cvg/desk-api`, `@cvg/chat` e `@cvg/events` >= 80% statements.
- `pnpm run test:coverage:critical` passa com thresholds reais.
- Nenhum skip sem justificativa e prazo.

### R1.3 Smoke/E2E dos fluxos centrais

Direcao:

- Login.
- Inbox/chat.
- Criacao e fechamento de tarefa.
- Nota interna.
- Alerta/ack.
- Admin/RBAC basico.
- Dashboard operacional.

Criterios de aceite:

- Smoke/E2E passa localmente ou em CI com ambiente controlado.
- Falhas geram artefatos suficientes para diagnostico.

## Sprint 2: Sessao HttpOnly, CSRF e realtime seguro

**Prioridade:** P0  
**Duracao estimada:** 3-5 dias  
**Objetivo:** remover token persistido no browser e fechar risco de seguranca.

### R2.1 Migrar login/logout para cookie seguro

Direcao:

- API emite cookie `HttpOnly`.
- Cookie usa `Secure` em producao.
- `SameSite` definido conforme arquitetura de dominio.
- Logout revoga sessao e expira cookie.
- Frontend deixa de persistir token web em storage.

Criterios de aceite:

- Busca por `localStorage`/`sessionStorage` nao encontra persistencia de token de sessao.
- Testes de login/logout passam.
- CSRF considerado para requests mutaveis.

### R2.2 Proteger requests mutaveis contra CSRF

Direcao:

- Implementar double-submit token, header CSRF ou estrategia equivalente.
- Exigir token CSRF em mutacoes quando autenticacao por cookie estiver ativa.
- Manter erros seguros sem vazar detalhe sensivel.

Criterios de aceite:

- Testes cobrem request mutavel sem CSRF, com CSRF invalido e com CSRF valido.
- `pnpm --filter @cvg/desk-api test` passa.

### R2.3 Realtime sem token em URL persistente

Direcao:

- Preferir cookie no handshake quando compativel.
- Como alternativa, emitir ticket efemero de curta duracao para WebSocket.
- Remover dependencia de token legado em URL para fluxo principal.

Criterios de aceite:

- Realtime autentica fluxo principal sem token persistido.
- Compatibilidade legada fica temporaria, monitorada e com prazo de remocao.
- Testes de revalidacao e expiracao passam.

## Sprint 3: Typecheck completo e CI de qualidade

**Prioridade:** P0/P1  
**Duracao estimada:** 1-3 dias  
**Objetivo:** transformar typecheck de pacotes criticos em typecheck de workspace.

### R3.1 Expandir `typecheck`

Direcao:

- Adicionar `typecheck` real em todos os apps/packages/modules.
- Ajustar `tsconfig` por pacote quando necessario.
- Manter excecoes apenas documentadas, temporarias e sem codigo runtime critico.

Criterios de aceite:

- `pnpm run typecheck` cobre workspace completo ou imprime matriz de excecoes aprovada.
- Nenhum pacote runtime depende apenas de `verify-package-source`.

### R3.2 CI/gates permanentes

Direcao:

- CI executa lint, build, typecheck, test, coverage critical e audit.
- Falha de coverage critico bloqueia merge.
- Warnings de manutencao relevantes viram falha ou excecao documentada.

Criterios de aceite:

- Pipeline reproduz comandos obrigatorios do plano executivo.
- Documentacao informa como rodar localmente.

## Sprint 4: Performance production-profile e prontidao operacional

**Prioridade:** P0  
**Duracao estimada:** 2-4 dias  
**Objetivo:** substituir QA local Docker por evidencia equivalente a producao.

### R4.1 Ambiente staging/prod-like

Direcao:

- Definir recursos, variaveis, banco, Redis e workers semelhantes ao deploy real.
- Garantir health/readiness estritos.
- Rodar seed e cleanup idempotentes.

Criterios de aceite:

- Ambiente documentado.
- `/health` e `/readiness` retornam estados coerentes.

### R4.2 Stress com perfil `production`

Direcao:

- Executar `QA_PERF_PROFILE=production TEARDOWN=1 pnpm run qa:full-cycle:archive`.
- Medir p95, 5xx, checks rate e endpoints lentos.
- Otimizar consultas ou fluxo quando necessario.

Criterios de aceite:

- `scenario_passed=true`.
- p95 <= 500ms ou SLO formal aprovado.
- 5xx <= 1%.
- checks >= 99%.
- Evidencia arquivada e referenciada em `docs/qa-full-cycle-log.md`.

## Sprint 5: Supply chain, deprecacoes e politica de upgrade

**Prioridade:** P1  
**Duracao estimada:** 1-2 dias  
**Objetivo:** tratar warnings transitivos e evitar regressao de dependencia.

Entregas:

- Atualizar dependencias quando houver versao compativel.
- Avaliar substituicao de pacote se dependencia depreciada nao tiver manutencao.
- Criar excecoes formais para transitivas sem solucao imediata.
- Registrar revisao mensal ou gatilho de upgrade.

Criterios de aceite:

- `pnpm audit --audit-level moderate` passa.
- Warnings de instalacao conhecidos tem plano, owner e data de revisao.
- Nenhum override inseguro ou sem teste.

## Sprint 6: Documentacao, nova auditoria e fechamento 98

**Prioridade:** P1  
**Duracao estimada:** 0.5-1 dia  
**Objetivo:** recalcular notas com base em evidencia final.

Entregas:

- Atualizar plano, roadmap, backlog e QA log.
- Criar novo relatorio de auditoria final.
- Atualizar matriz de score de todos os itens para 98+ somente se gates passarem.
- Registrar riscos encerrados e qualquer excecao remanescente aprovada.

Criterios de aceite:

- Novo relatorio em `docs/` com nota por item.
- Todos os itens analisados no relatorio 81 aparecem com nota >= 98.
- Score geral minimo 98/100.

## Sequencia visual

| Marco | Foco | Saida esperada |
|---|---|---|
| M0 | Baseline | Mapa de lacunas para 98 |
| S1 | Coverage/testes | Pacotes criticos >= 80% e fluxos cobertos |
| S2 | Auth segura | Sem token web em storage; cookie/CSRF/realtime seguro |
| S3 | Typecheck/CI | Workspace tipado e gates permanentes |
| S4 | Performance | QA production-profile com SLO comprovado |
| S5 | Supply chain | Dependencias tratadas ou excecoes formais |
| S6 | Auditoria final | Todos os itens >= 98/100 |

## Riscos de execucao

| Risco | Impacto | Mitigacao |
|---|---|---|
| Migracao HttpOnly quebrar realtime ou CORS | Alto | Implementar com testes de contrato e rollback por flag. |
| Coverage subir por testes fracos | Medio | Exigir testes por fluxo, nao apenas por linha. |
| Ambiente production-like nao refletir producao real | Alto | Documentar recursos e variaveis, comparar com deploy previsto. |
| Dependencia transitiva nao ter substituto | Medio | Criar excecao formal com owner e revisao. |
| Escopo de Dashboard virar BI | Medio | Aplicar checklist de escopo antes de cada item. |
