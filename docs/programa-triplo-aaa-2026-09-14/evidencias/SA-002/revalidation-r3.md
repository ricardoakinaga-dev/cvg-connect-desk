# SA-002-R3-A1 — Revalidação corrente de contratos, decisões e denominadores

**Candidato:** `754f9badac46278e77d21de91c58eedb15e80581+worktree#product-4ee19f2ec5ca8bff`  
**Revisão:** `754f9badac46278e77d21de91c58eedb15e80581`  
**Data:** 15/09/2026  
**Produto:** `NOT_READY`

## AC1 — Contratos e gates

`CONTRATOS.md` permanece na versão C-1 e agora traz uma matriz explícita para cada C01–C10 com sucesso, erro/negação e consumidor/prova. `CRITERIOS.md` mantém a versão G-1 e acrescenta uma matriz G01–G12 com consumidor, sucesso e erro. A validação automatizada confirma 10 contratos, 12 gates e 59 requisitos ligados na rastreabilidade.

Os exemplos são contratos de comportamento, não evidência de que o produto já passou pelos gates. As provas produtoras continuam nas tarefas SA-004–058 e a adjudicação final continua em SA-059.

## AC2 — Decisões

D01–D06 continuam `OPEN`. Cada linha registra proposta, alternativa/consequência, impacto, subações afetadas, preparo permitido, autoridade e limite real. `AUTORIZACAO-MATRIZ.md` permanece coerente com D01 OPEN. Nenhum silêncio, arquivo, estado de backlog ou preparo local é tratado como aprovação.

## AC3 — Denominadores

`frozen-denominators.json` e a seção QB-1 preservam:

- coverage provider v8 e ordem statements/branches/functions/lines, com shared 85/80/85/85 e metas core/domain/api/web/global;
- workload de 10.000 conversas, 100.000 mensagens, 100 sessões, 10 min de aquecimento, 30 min de medição e 3 rodadas;
- matriz visual 16 rotas × 5 viewports, 80 combinações normais, estados adicionais, fronteiras, zoom/reflow e ergonomia;
- método 40/25/25/10, cada item/dimensão ≥95 sem arredondamento e confiança ALTA com revisor independente;
- regra de não reduzir denominadores após falha.

Os thresholds efetivos dos demais escopos continuam delegados a SA-050; isso é limitação declarada, não redução de meta. A documentação também não certifica coverage, workload, UX, gates ou release.

## Resultado

`validate_sa002_docs.py` é uma checagem de completude documental; `programa.py validate` é estrutural. A evidência corrente e a crítica I1 ainda são necessárias antes de qualquer promoção terminal de SA-002.
