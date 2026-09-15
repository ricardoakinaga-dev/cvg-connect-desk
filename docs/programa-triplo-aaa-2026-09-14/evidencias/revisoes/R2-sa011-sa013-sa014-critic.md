# R2 — Crítica independente de SA-011 / SA-013 / SA-014 (2ª passagem após REJECTED)

**Persistido pelo lead** a partir da entrega inline do crítico (harness somente leitura). Conteúdo fiel; formatação normalizada.

**Independência:** I1 — contexto novo, mesma família de modelo, filesystem compartilhado; nenhuma mutação de artefato observada.
**Limite declarado:** inspeção estática; hashes/execuções não foram reproduzidos pelo crítico.

## Primeira passagem (REJECTED) — achados

| # | Sev. | Achado | Correção aplicada |
|---|---|---|---|
| 1 | Blocker | Selo pré-correção; arquivos editados depois do selo | Novo selo `#698bc9edeecf8cac` → depois `#fe8280bef538251e` cobrindo testes e produto; nenhum artefato pós-selo |
| 2 | Critical | Suíte SA-014 reprovava `test:ci` em ambiente CI-shaped (guarda cvg_aaa_* incondicional) | Guarda condicional a `AAA_RUN_ID` (padrão SA-013); macro verde (`r2-wave6`, `r2-wave7`) |
| 3 | High | UUID inválido em rotas de detalhe → 500 | Hook global `preValidation` (params `*Id`; `id` exceto rotas textuais da DLQ) + handler 5xx genérico; teste cobre 14 rotas |
| 4 | High | Oráculos de existência em `/contacts/:id/{groups,labels,transfers}` (404 vs 200 []) e Kanban (corpos 404 distintos) | Contato inexistente → mesmo 404 `Contact not found`; Kanban unifica `Conversa não encontrada`; caso 8 |
| 5 | High | Inventário de rotas incompleto (app.ts, código morto, contagens erradas) | Auditoria inclui app.ts, separa pacote não registrado, reporta 147/119/5; contagens corrigidas na evidência |
| 6 | Medium | Semântica de receipt com o MESMO `event_id` superestimada | `RELATORIO.md` §4.5 registra 409 `event_in_progress` e dependência da reconciliação limitada; citação de prod-07 corrigida |
| 7 | Medium | Correção da SA-013 sem artefatos de runner | `runs/sa013-oracles/` e `runs/sa013-ws-default{,2}/` anexados |
| 8 | Medium | Corpo 5xx vazava `statusCode`/`timestamp`/`error.code` | 5xx responde apenas `{error:'INTERNAL_ERROR',message:'Erro interno'}`; teste dedicado |
| 9 | Medium | Matriz omitia pacientes/tutores/etiquetas | Seção “Lacunas de escopo declaradas” com D01 OPEN e regra vigente |
| 10 | Low | Citação prod-07; controle negativo da allowlist; WS com 1s/1s | Citação corrigida; `--self-test` do detector com controle negativo; WS reexecutado com defaults de produção (2000/2000) e revogação em 2719 ms |

## Segunda passagem — correções verificadas

O crítico classificou como **CORRECTED**: itens 1–5, 7, 8 e 10; **PARTIALLY_CORRECTED** com exigências de bookkeeping: itens 6 e 9 (RELATORIO não atualizado como prometido; matriz sem pacientes/tutores/etiquetas) e metadados das entradas de correção (horários/`candidate_id` antigos/hashes desatualizados).

**Correções subsequentes do lead (antes da promoção):**
- Metadados de SA-011/SA-013/SA-014 alinhados aos artefatos reais e ao selo final (`#fe8280bef538251e`), com hashes dos testes (`96e58728…`, `04af4072…`, `520d20cb…`, `79012bb8…`).
- `RELATORIO.md` da SA-014 com citação corrigida, §4.5 e cabeçalho de candidato/hash.
- Matriz com a seção de lacunas declaradas (pacientes/tutores/etiquetas sob D01) e citação do run real (`sa013-oracles`).
- Controle negativo do detector (`--self-test`) integrado ao teste de fronteira; macro final `regress-2-wave7` exit 0 com tails maiores.

## Resultado final por tarefa (2ª passagem)

| Tarefa | Veredito |
|---|---|
| SA-011 | Funcionalmente satisfeita; bookkeeping corrigido |
| SA-013 | Prova executável sólida (casos 1–8); lacunas de escopo declaradas |
| SA-014 | 8/8 guard-aware; macro verde; semântica de receipt honesta |

## REVIEW_RESULT: APPROVED_WITH_FINDINGS (findings de bookkeeping resolvidos pelo lead na sequência)
