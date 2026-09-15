# R2 — Crítica independente de SA-015 / SA-019

**Persistido pelo lead** a partir da entrega inline do crítico (harness somente leitura). Conteúdo fiel; formatação normalizada.

**Independência:** I1 — contexto novo, mesma família de modelo, filesystem compartilhado; nenhum artefato mutado.
**Limite:** inspeção estática; execuções/hashes não reproduzidos pelo crítico.

## Contexto

Os builders entregaram as duas tarefas como REWORK após encontrarem 10 defeitos reais (SA-015: D1 tutor 500, D2 paciente 500, D3 responsável fora do setor aceito, D4 dueAt 500; SA-019: D1 duplicata 500, D2 contato inexistente 500, D3 contato alheio adicionado, D4 contato alheio removido, D5 rota DELETE ausente, D6 vazamento de nome/telefone). O lead corrigiu o produto e converteu os `it.fails` em `it`.

## Veredito por tarefa

| Tarefa | Veredito | Comentário |
|---|---|---|
| SA-015 | **NOT REFUTED** nos defeitos D1/D2/D4 e na atomicidade (validações dentro do `db.transaction`, sem linhas órfãs); **PARTIAL** em D3 (teste aceitava 400/403 sem código/órfãos) e no teste de inativo (inexistente) | Correções do lead aplicadas |
| SA-019 | **NOT REFUTED** em D1–D6 (idempotência, existência, escopo de contato, rota DELETE, filtro de membros/contagem); **PARTIAL** no contrato 403×404 (colapso para 404 divergia da matriz) | Correção do lead aplicada |

## Achados e resolução

| # | Sev. | Achado | Resolução |
|---|---|---|---|
| H1 | High | Entradas de evidência citavam o selo pré-correção `#fe8280…`, não o selado | Novas entradas vinculadas ao selo vigente (`#95c8af61…` → `#c486a63f…`) com hashes dos arquivos alterados |
| H2 | High | `RELATORIO.md` da SA-015 ainda declarava REWORK/defeitos abertos | Cabeçalho de supersessão apontando as execuções finais |
| M3 | Medium | Timestamps das entradas de correção não batiam com os runner summaries | Reescritos com os horários reais dos runs |
| M4 | Medium | Evidência afirmava teste de responsável inativo e zero órfãos sem cobertura | Novo teste `D5` (inativo → 400 `INVALID_ASSIGNEE`, zero tarefa/audit/outbox) e contagens por correlação em D1–D3 |
| M5 | Medium | Add/remove de membros colapsava 403 (lê mas não escreve) em 404, divergindo da matriz | Pass-through `403/404` implementado e coberto por teste dedicado (ator com escrita no setor do grupo e leitura no setor do contato) |
| L6 | Low | Probe D3 aceitava `[400,403]` sem código | Agora exige 400 `INVALID_ASSIGNEE` |
| L7 | Low | DELETE de label de contato retornava 200 para label inexistente | Mantido (delete idempotente) e documentado; POST continua 404 |
| L8 | Low | Fallback `visible ?? result.value` em corrida de exclusão; N+1 no catálogo | Registrado como limitação; sem impacto nos ACs |
| L9 | Low | Arquivo de probe sobrescrito por runs macro | Registrado; probe é evidência auxiliar, não gate |
| L10 | Low | Coerência paciente↔tutor não implementada | Fora do texto dos ACs; registrado |

## Verificações executadas após as correções

- SA-015: `sa015-fix2` **12/12**, exit 0 (04:56:11–18Z).
- SA-019: `sa019-fix3` **23/23**, exit 0 (04:55:15–21Z).
- Macro `test:ci` `r2-wave9`: exit 0, posteriores às correções.

## REVIEW_RESULT: APPROVED_WITH_FINDINGS (findings resolvidos e reexecutados pelo lead)
