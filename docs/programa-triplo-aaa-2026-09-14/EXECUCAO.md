# Registro de execução — Programa Triplo AAA

**Fonte de estados:** [BACKLOG.json](BACKLOG.json). **Checkpoint vigente:** auditoria R3 de 15/09/2026. **Produto:** `NOT_READY`.

## Estado canônico após a auditoria R3

| Estado | Tarefas | Pontos | Interpretação |
|---|---:|---:|---|
| DONE | 2 | 8 | SA-001 fechada com evidência corrente/I1; SA-002 fechada após reconciliação documental e I1 independente. |
| REWORK | 17 | 98 | 85 pontos de requalificação; SA-017 implementada na onda concorrente R2.3, pendente de dependências/I1; SA-022 mantém 5 pontos de lacuna funcional. |
| PLANNED | 44 | 305 | Implementação ou prova ainda não iniciada. |
| Não DONE | 61 | 403 | Inclui 98 pontos de requalificação, 8 implementados pendentes de dependências/I1, 5 de rework funcional e 305 planejados. |

**Próxima elegível por dependência:** SA-003 e SA-020. SA-001 restaurou a identidade do candidato e SA-002 fixou a barra documental; a fundação e M1 seguem em lotes pequenos conforme a [rodada R3](rodadas/R3/README.md).

## SA-001-R3-A2 concluído

O candidato corrente está sendo reconstruído por `scripts/programa-triplo-aaa/candidate_manifest.py` v2. O selo `product_sha256` exclui os prefixos canônicos de controle; `ledger_sha256` cobre separadamente o programa e as auditorias, com evidências/manifests derivados fora do digest para evitar autorreferência. `.env.production.example`, modos, symlinks, adições/remoções e alterações staged têm controles determinísticos em `scripts/programa-triplo-aaa/test_candidate_manifest.py`.

O manifesto completo, a comparação com o `source-manifest.json` histórico, a revalidação A01–A10, o ambiente e a crítica I1 ficam em `evidencias/SA-001/`. Os artefatos históricos seguem `BASELINE`/`STALE`; a I1 aprovou SA-001 no candidato corrente. Isso não promove G01/G12 nem certifica o produto inteiro.

## Por que 17 tarefas foram reabertas

No snapshot de entrada, a auditoria independente conferiu 101 referências de evidência e 88 registros JSONL. Execuções concorrentes posteriores adicionaram três referências e 17 registros ligados ao selo `#128b1a64...`. O [inventário reproduzível](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/EVIDENCE-INVENTORY.json) registra agora 104 referências íntegras e 105 registros. Somente dois usam o candidato de entrada completo `#c486a63f...`; as provas posteriores não revertem a adjudicação porque G01 continua falho e não há I1 final independente em artefato próprio. Revisões R2 também registram findings/resultado parcial seguidos por correções do lead sem nova passagem I1 comprovada.

Falhas diretas adicionais:

- SA-014: faltam crash/SIGKILL e suítes production de AC3;
- SA-015: falta fault injection na última escrita de AC2;
- SA-019: faltam exclusão em uso, busca/paginação, seletor e eventos;
- SA-020: o ensaio aceita perda N:N no rollback e não possui autoridade nominal;
- SA-012: AC3 de erro de rede/bootstrap não foi executado como registrado;
- SA-011: inventário atual é 148 rotas/120 com schema/5 mutações na allowlist, não 147/119/5.

## Candidato e integridade

Na entrada da auditoria, antes de persistir os artefatos R3, o snapshot anterior reproduziu `754f9badac46278e77d21de91c58eedb15e80581+worktree#c486a63f161da313`. Ele é **inválido para G01**:

- não é objeto Git imutável;
- exclui o livro-caixa do programa;
- não incorpora os bytes de `.env.production.example` ao `tree_sha256`;
- um controle negativo alterou esse arquivo sem mudar o digest.
- inclui `docs/auditorias/` como produto; registrar esta auditoria altera o candidato, embora não altere o software.

SA-001 reparou o gerador, selou produto e controle e obteve crítica I1. SA-002 revalidou contratos, decisões e denominadores sem aprovar decisões OPEN, reconciliou a ponte documental e obteve aprovação I1 no candidato corrente. A próxima tarefa elegível é SA-003; qualquer promoção posterior deve usar o candidato corrente.

## Verificações da auditoria R3

- `programa.py validate` antes da reabertura: PASS estrutural, 17/2/44.
- `pnpm typecheck`: PASS, 33/33, com [log selado](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/evidencias/typecheck.log).
- `pnpm test:ci` no runner isolado `audit-r3-regression`: exit 0 e cleanup concluído; a macro continua omitindo suítes AAA/production.
- SA-015 + SA-019 no runner `audit-r3-sa015-sa019`: 35/35; prova não cobre os aceites faltantes.
- `pnpm lint`: FAIL, 32/33; realtime 29 warnings para limite 26; 110 warnings somados ([log](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/evidencias/lint.log)).
- `pnpm build`: PASS 6/6; JS 121,64 KiB gzip reprova o orçamento 120; CSS 24,09 KiB atende 25 ([log](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/evidencias/build.log)).
- `prod-36.test.mjs`: FAIL_HARNESS 4/5 por assertion obsoleta de `localhost` contra Dockerfile em `127.0.0.1`; não julga o produto em G09 ([log](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/evidencias/prod-36.log)).
- UX manual, coverage por camada, carga, segurança completa, DR durável e E2E final: NOT_RUN.

Relatório: [auditoria R3](../auditorias/2026-09-15-checkpoint-triplo-aaa-r3/RELATORIO.md).

## Gates e decisões

- G01, G05, G08 e G11: FAIL.
- G09: NOT_RUN/INVALID pelo harness obsoleto.
- G02–G04, G06, G07, G10 e G12: NOT_RUN coletivamente no candidato final.
- D01–D06: OPEN.
- SA-059: não executada e bloqueada pelas entregas anteriores.
- Os títulos “Triplo AAA — candidato qualificado” e “Triplo AAA em operação” continuam proibidos.

## Próxima ação exata

1. SA-003: preparar runner e dependências de teste realmente isolados.
2. SA-003/004: requalificar isolamento e DTO/logs.
3. SA-005–010: requalificar M1 no mesmo candidato.
4. Em seguida fechar SA-014, SA-020, SA-015, SA-019 e SA-012 pelos aceites ausentes.
5. Continuar pela ordem da [R3](rodadas/R3/BACKLOG-R3.md).


## Evidência concorrente R2.3 — SA-017

- Uma execução concorrente registrou `PASS 22/22` para agendador, janelas, concorrência, loop residente, replay do worker e CAS HTTP. Artefato principal: [sa-017-alerts-worker.json](evidencias/SA-017/runtime/sa-017/sa-017-alerts-worker.json), SHA256 `1c7ad2255f0cd59ccf79658253a66594b5499aa463230306b2943d8f24596343`.
- O registro [evidence.jsonl](evidencias/SA-017/evidence.jsonl), SHA256 `081d2fbd7e7690d51b03e4b032af9fad6914988d9aacb46767f1f01d080e3e37`, declara um crítico no campo `reviewer`, mas não existe artefato independente de revisão referenciado. Além disso, SA-013/SA-015 foram reabertas e o candidato não atende G01.
- Estado canônico de SA-017: `DONE / CURRENT`. SA-001 e SA-002 estão ligadas ao candidato válido e têm crítica I1 independente; a certificação do produto e dos gates produtores permanece pendente nas tarefas correspondentes.
