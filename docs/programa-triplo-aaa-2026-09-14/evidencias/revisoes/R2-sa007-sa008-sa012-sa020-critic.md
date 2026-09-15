# R2 — Crítica independente de SA-007 / SA-008 / SA-012 / SA-020

**Persistido pelo lead** a partir da entrega inline do crítico (o harness do crítico é somente leitura e não escreve arquivos). Conteúdo fiel; formatação normalizada.

**Independência:** I1 — contexto novo, mesma família de modelo, filesystem compartilhado; nenhum histórico do construtor; nenhum artefato mutado.

**Limite declarado pelo crítico:** todas as provas de runtime (typecheck, vitest, Playwright, ensaio SA-020, lifecycle HTTP/WS) foram adjudicadas por inspeção estática de logs/JSON e das imagens; nada foi reexecutado e hashes não foram recomputados.

## Veredito por tarefa

| Tarefa | Veredito | Base |
|---|---|---|
| SA-007 | **NOT REFUTED** (F7) | teardown `app.close()` → `getPool().end()` sem cast; atomicidade 1 conversa ativa preservada |
| SA-008 | **NOT REFUTED com achados** (F4, F8) | 6/6 em dois relatórios; 404 de setor real asserido; remount provado por `waitForRequest` |
| SA-012 | **PARTIAL** (F2, F3) | HTTP completo; WS sem perna de expiração e sem concorrência entre abas; contagem 28 ≠ 27 |
| SA-020 | **PARTIAL** (F5, F6, F1) | SQL/backfill OK no escopo testado; rollback só provava o legado; autoridade nominal ausente |

## Achados e resolução

| ID | Sev. | Achado | Resolução aplicada |
|---|---|---|---|
| F1 | High | Manifesto selado não cobria `decisoes/`, scripts e evidências de SA-012/020; sem campo de tree hash | Manifesto regenerado com `candidate.id` e `tree_sha256` (selo sobre produto/testes; livro-caixa excluído); arquivo de onda anterior preservado |
| F2 | Med-High | SA-012 sem WS-expiração, sem concorrência entre abas, sem bootstrap/rede; `waitClose` não registrava código | Script ganhou: expiração WS com fechamento ≤5s, rotação concorrente (1 vence/1 401), abas com token expirado (2×401), `auth/me` sem token/malformado, injeção de falha na troca de credencial (rollback do commit) e código **4002** registrado |
| F3 | Medium | “28 checks” incorreto (eram 27) | Contagem real: **32** após as correções; evidência atualizada |
| F4 | Medium | Regressão 3/3 de `sa-006-role-permissions` sem artefato de execução | `runner-summary.json` do run `sa006-role` anexado às evidências da SA-008 |
| F5 | Medium | “rollback/rollforward sem perda” mais estreito que o texto; backfill podia violar o índice parcial com primário divergente | SQL ganhou `NOT EXISTS (primário)`; ensaio 12/12 com divergência de primário, não promoção de vínculo não-primário e perda explícita do vínculo N:N |
| F6 | Med-Low | Autoridade nominal em aberto; inventário omitia migrações/testes da Secretary; total não reproduzível | D03 aceita explicitamente “a registrar”; inventário reproduzível com **113 linhas** e arquivo bruto; entradas de migração/testes adicionadas |
| F7 | Low | Typecheck logado (02:50) era anterior às mudanças da SA-008 | `pnpm typecheck` reexecutado no worktree final: **33/33** (`typecheck-final.log`) |
| F8 | Low | Comentário do `provisionRbac` impreciso; timestamps das evidências divergentes; estado acumulado nos screenshots | Comentário corrigido; timestamps reconciliados com os relatórios; limitação do estado acumulado registrada |

## Correções restantes

Nenhuma pendente: todos os itens exigidos foram aplicados e re-verificados. Permanecem como limitações declaradas: validação estática do crítico (sem reexecução), screenshots em dev server com dados acumulados de execuções anteriores (asserções usam sufixo único por run) e rollback pós-cutover dependente de dump da tabela nova.

## REVIEW_RESULT: APPROVED_WITH_FINDINGS (findings resolvidos antes da promoção a DONE)
