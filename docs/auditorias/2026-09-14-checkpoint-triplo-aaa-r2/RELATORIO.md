# Auditoria do checkpoint — Programa Triplo AAA

**Data de observação:** 14/09/2026, America/Sao_Paulo. **Revisão:** R2. **Veredito:** `PARTIAL / NOT_READY`.

## Síntese executiva

O checkpoint representa progresso técnico real. A regressão `test:ci`, o ensaio realtime e o ensaio de DR passaram novamente em ambientes isolados durante esta auditoria. As correções de DTO, transações, realtime e restauração têm evidência relevante e não foram refutadas no escopo exercitado.

O programa continua longe da qualificação: 8 tarefas permanecem `DONE`, 4 foram reabertas como `REWORK` e 51 continuam `PLANNED`. Restam **55 tarefas para chegar a DONE**. SA-059 não foi executada, as 59 notas não foram recalculadas e G01–G12 continuam sem aprovação conjunta.

## Achados prioritários

| ID | Severidade | Observação | Efeito e encaminhamento |
|---|---|---|---|
| R2-F01 | High | SA-008 estava `DONE`, mas seu AC2 exige browser+API real, back, refresh e deep-link. A evidência usa API real separada de UI jsdom mockada; a re-revisão declara F3 fora do escopo. | SA-008 reaberta para `REWORK`; fechar a prova integrada antes de qualquer dependente. |
| R2-F02 | High | `pnpm typecheck` falha em `sa-007-start-conversation.integration.test.ts:83`: `db.close` não existe no tipo de `db`. | SA-007 reaberta para `REWORK`; corrigir o teste, repetir typecheck e integração isolada. |
| R2-F03 | High | A identidade `754f9bad+worktree` é mutável. Desde o manifesto de SA-001, 65 arquivos com hash mudaram, 25 fora dos artefatos/cartões do programa. | O checkpoint não tem candidato atual selado e G01 permanece aberto; gerar identidade completa após estabilizar a próxima onda. |
| R2-F04 | Medium | SA-022 não cobre todo o AC2: faltam handoff, reabertura, tarefa e alerta. O AC3 ainda aguarda D01 e `EXPLAIN`. | SA-022 movida de `IMPLEMENTED` para `REWORK`; executar somente depois de SA-013/017/018. |
| R2-F05 | Medium | SA-017 foi marcada `IMPLEMENTED` com SA-013 e SA-015 abertas. A prova chama o scanner de regras diretamente; não demonstra disparo pelo worker real pedido no procedimento. | SA-017 movida para `REWORK`; integrar após as dependências e obter crítica nova. |
| R2-F06 | Medium | O validador aceitava `IMPLEMENTED` com dependências abertas e verificava apenas a presença textual de `review_ref`. | Validador endurecido para dependências em `IMPLEMENTED/REVIEW` e existência dos arquivos de revisão. Semântica e independência ainda exigem julgamento. |
| R2-F07 | Medium | `pnpm lint` retorna 0 com **142 avisos** porque vários pacotes permitem limites locais. | Tratar em SA-063/SA-050; a meta de zero avisos continua aberta. |
| R2-F08 | Medium | O build passou, mas o JS inicial medido foi **121,64 KiB gzip**, acima do orçamento de 120 KiB. CSS ficou em 24,09 KiB, dentro de 25 KiB. | Reduzir e medir novamente em SA-056; não arredondar o JS para aprovação. |
| R2-F09 | Medium | O `MANIFESTO.json` documental tinha 17 entradas divergentes e README/VALIDACAO/PLANO ainda descreviam todas as tarefas como não iniciadas. | Documentação atualizada e manifesto regenerado com 83 arquivos nesta auditoria. |
| R2-F10 | Medium | Não existe evidência atual da matriz visual 16×5, estados, leitor de tela e dispositivo móvel real. | UX e acessibilidade permanecem `NOT RUN`; executar SA-048/049 depois da integração das superfícies. |
| R2-F11 | Low | SA-004 cobre DTO/RBAC por teste e teve inspeção estática de logs, mas F9 não foi reavaliado na segunda crítica e não há teste executável do caminho de log/erro sem segredo. | Preservar `DONE` no escopo funcional; acrescentar prova negativa e crítica antes de SA-059. |

## Estado auditado

- M0: 3/3 tarefas `DONE`.
- M1: 5/7 `DONE`; SA-007 e SA-008 em `REWORK`.
- M2: nenhuma tarefa `DONE`; SA-017 e SA-022 em `REWORK`; as demais, `PLANNED`.
- M3–M7: nenhuma tarefa `DONE`.
- D01–D06: `OPEN`; só as subações dependentes ficam bloqueadas.
- Produto: `NOT_READY`; sem candidato Triplo AAA qualificado.

## Verificações executadas

| Procedimento | Resultado observado | Limite |
|---|---|---|
| `programa.py validate` e `next` | PASS após o replanejamento: 63 tarefas, 59 requisitos, DAG válido | Estrutura não prova comportamento. |
| `test:ci` no runner `audit-r2-full` | exit 0; PG/Redis próprios encerrados | O script exclui suítes AAA/produção e não mede coverage. |
| `sa-009-realtime-boot.ts` | PASS 20/20; imagem `sha256:75ba…49572`; WS, degradação e recuperação | Uma imagem local de auditoria não é a imagem final de release. |
| `sa-010-dr-run.ts` | PASS; 25 checagens de restore | Backup e restore no mesmo host; não prova durabilidade de SA-055. |
| `pnpm lint` | exit 0; 33/33 tarefas; 142 avisos | Limites locais permitem avisos. |
| `pnpm typecheck` | FAIL; 32/33 tarefas | Falha em teste de SA-007. |
| `pnpm build` | PASS; 6/6 tarefas | Desk API não possui tarefa de build; JS web excede orçamento. |

## Conclusão

O checkpoint tem correções úteis e provas operacionais reproduzíveis, mas seus estados estavam mais avançados do que as evidências permitem. A nova rodada deve começar por SA-007 e SA-008, manter SA-017/022 em rework e selar um novo candidato somente depois dessas correções. A [rodada R2](../../programa-triplo-aaa-2026-09-14/rodadas/R2/README.md) contém o roadmap e o backlog de retomada.
