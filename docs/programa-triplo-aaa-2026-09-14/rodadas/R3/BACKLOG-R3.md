# Backlog priorizado da rodada R3

Esta fila não substitui o [BACKLOG.json](../../BACKLOG.json). Estados, dependências, aceites e evidências continuam canônicos no JSON e nos cartões.

## P0 — restaurar confiança no controle

| Ordem | Tarefa | Fechamento exigido |
|---:|---|---|
| 1 | [SA-001](../../tasks/SA-001.md) | Corrigir o ponto cego e separar escopos; controles known-good/known-bad; manifestos de produto e livro-caixa; I1 atual. |
| 2 | [SA-002](../../tasks/SA-002.md) | Revalidar contratos, decisões e denominadores no candidato aceito. |
| 3 | [SA-003](../../tasks/SA-003.md) | Remover `fuser -k`/portas sem ownership; reexecutar falhas de provisionamento e cleanup. |
| 4 | [SA-004](../../tasks/SA-004.md) | Reexecutar DTO e prova negativa de logs/erros sensíveis; crítica nova. |

## P0 — fechar falhas diretas de aceite após os pré-requisitos

Esta seção expressa prioridade de risco. A execução respeita a DAG: SA-005/007 precedem SA-014; SA-002/003 precedem SA-012; SA-006/012 precedem SA-013; SA-013 e SA-008 precedem SA-015/019. SA-020 depende de SA-002.

| Ordem | Tarefa | Fechamento exigido |
|---:|---|---|
| 5 | [SA-014](../../tasks/SA-014.md) | Crash, SIGKILL, restart, replay e convergência no candidato. |
| 6 | [SA-020](../../tasks/SA-020.md) | Rollback/rollforward sem perda ou mudança formal do requisito; autoridade nominal. |
| 7 | [SA-015](../../tasks/SA-015.md) | Fault injection na última escrita com zero efeito parcial. |
| 8 | [SA-019](../../tasks/SA-019.md) | Exclusão em uso, busca/paginação, seletor canônico e eventos/invalidação. |
| 9 | [SA-012](../../tasks/SA-012.md) | Erro de rede/bootstrap executado; horários reais; HTTP/WS no mesmo run. |

## P1 — requalificar implementações preservadas

`SA-005, SA-006, SA-007, SA-008, SA-009, SA-010, SA-011, SA-013`.

Para cada uma: mapear todos os ACs, executar a fronteira pública, anexar prova com candidato exato, obter I1 depois da última mudança e somente então promover.

## P1 — avançar domínio

Após as dependências: `SA-016, SA-017, SA-018, SA-021, SA-022, SA-023, SA-024, SA-025, SA-026, SA-027, SA-028, SA-029, SA-030, SA-031, SA-032`.

Prioridades:

- SA-016: notas contextuais completas.
- SA-017: worker real, idempotência por janela e CAS de ack/resolve.
- SA-018: transferências com revogação, concorrência e eventos.
- SA-022: fixtures de handoff/reabertura/tarefas/alertas, D01 e `EXPLAIN`.

## P1 — qualidade, UX e prova final

1. SA-063: corrigir lint 32/33 e reduzir warnings a zero material sem elevar allowances.
2. SA-033–SA-049: implementar e inspecionar as 16 superfícies, estados, responsividade, teclado, leitor de tela e dispositivo real.
3. SA-050: cobertura por camada e execução obrigatória de todas as suítes AAA/production no CI.
4. SA-051 e SA-055: identidade de imagens e DR durável; SA-054 fecha observabilidade antes de performance.
5. SA-056: após SA-054, JS inicial ≤120 KiB gzip e Web Vitals dentro da barra.
6. SA-058: após SA-051/055, E2E real; SA-057 fecha documentação somente depois de SA-056/058.
7. SA-059/060: qualificação e pacote somente depois dos gates anteriores.
8. SA-061/062: dependem de autoridade e operação real.

## Resumo quantitativo de entrada

| Classe | Tarefas | Pontos |
|---|---:|---:|
| Requalificação de tarefas antes DONE | 17 | 93 |
| SA-017 implementada, pendente de dependências/I1 | 1 | 8 |
| Rework funcional SA-022 | 1 | 5 |
| Planejado | 44 | 305 |
| Total não DONE | 63 | 411 |
