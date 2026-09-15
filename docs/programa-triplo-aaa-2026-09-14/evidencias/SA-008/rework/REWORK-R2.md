# SA-008 — Rework R2 (prova browser+API real)

**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree.

## Achado R2-F01

A evidência anterior separava API real (integração) de UI jsdom (mockada); faltava a prova integrada em **navegador real + backend real** com duas conversas, back/forward, refresh, deep-link e negativos.

## Correção (prova executada)

Spec `e2e/aaa/sa-008-context.spec.ts` na stack isolada AAA (`start-aaa-stack.ts`): PostgreSQL/Redis exclusivos do run, migração, fixture mínima, mock Evolution, desk-api, realtime e desk-web reais; navegador Chromium real.

Dados contextuais criados **via API real** (token de fixture): tarefas, alertas e notas nas conversas A e B.

| # | Cenário | Resultado |
|---|---|---|
| 1 | Inbox → atalhos → Tarefas/Notas/Alertas filtram por A, criação pré-preenchida e volta à conversa | PASS |
| 2 | Back, forward, refresh e deep-link preservam contexto; remover filtro é explícito | PASS |
| 3 | Alternância A↔B (3 rodadas) isola thread, seleção e painel de contexto | PASS |
| 4 | Negativos: UUID inválido → "Contexto inválido"; inexistente → "Contexto inacessível" sem títulos; **acesso cruzado com RBAC real**: Agente A recebe `tasks:read` via `PUT /admin/roles` e o SERVIDOR responde **404** na conversa B (asserção do status HTTP no browser) | PASS |
| 5 | Móvel 390×844: contexto visível, sem overflow, tarefa prioritária no primeiro viewport | PASS |
| 6 | Falha de transporte injetada na API (fetch) → erro recuperável "Sem conexão" e retry real preserva contexto | PASS |

**Resultado dos relatórios:** `playwright-report-run1.json` e `playwright-report-run2.json` — ambos `expected 6, unexpected 0, skipped 0, flaky 0` (duas execuções completas).

## Evidência visual

`screenshots/` (viewport/estado no nome): Inbox com painel aberto 1440, Tarefas contextuais 1440, Notas contextuais 390, contexto inacessível 1440.

## Achado de produto corrigido durante a prova

O papel customizado não podia ser editado com `PUT /admin/roles/:id` enviando **apenas** `permissionIds`: o drizzle recebia `.set({})` vazio e a rota respondia **500** (`Failed to update role`). Corrigido em `modules/admin/src/infrastructure/repositories/admin.repository.ts` (update só executa o SET quando há campos; `assignPermissions` insere antes de remover e participa do MESMO `tx`) com mapeamento de FK para `400 INVALID_PERMISSION` no caso de uso. Regressão: `apps/desk-api/src/__tests__/sa-006-role-permissions.integration.test.ts` (3/3). Este achado também é insumo da SA-044 (admin UI).

## Limitações

- Vite dev server (não build de produção) para velocidade da prova funcional; Web Vitals/budget ficam em SA-056.
- A falha de transporte é injetada na camada de rede do navegador (documento e servidor reais); o caminho de erro 404 real também é exercitado.
- O candidato selado (`evidencias/SA-001/candidate-manifest.json`) é regenerado após esta onda para incluir a spec e os artefatos de rework; a geração anterior é histórica.
- Revisão independente em `evidencias/revisoes/R2-sa007-sa008-critic.md` (APPROVED_WITH_FINDINGS; correções aplicadas).
