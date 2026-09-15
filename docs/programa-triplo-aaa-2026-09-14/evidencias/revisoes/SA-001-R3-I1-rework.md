# SA-001-R3-A1 — I1 independente (REWORK)

**Revisor:** Heisenberg (contexto fresco, somente leitura). **Data:** 15/09/2026.
**Candidato inspecionado:** revisão `754f9badac46278e77d21de91c58eedb15e80581` + worktree, `product_sha256=621a1a5e9201f9378518ed46a85bedfdf5380826644088e3a41984a7dcf2a719`, `ledger_sha256=2ebcfc08da46e35eeac286d85b9894ac23e30eb7e34dd01d0ffaad52000ad426`.

## Verificações confirmadas

- Manifesto, ambiente, comparação e JSONL concordavam na revisão e nos dois selos.
- `.env.production.example` tinha digest não nulo; os controles known-good/known-bad passaram 7/7 na rodada corrente.
- Produto e livro-caixa estavam separados; auditoria não alterava `product_sha256`.
- A01–A10 apareciam exatamente uma vez, classificados como 7 corrigidos no caminho atual, 2 parciais e 1 aberto, sem remoção de aceite.
- `programa.py validate` era estruturalmente válido e não foi confundido com certificação.

## Rework exigido

1. Registrar uma crítica I1 posterior à última alteração antes de qualquer `DONE`; esta revisão é um bloqueio, não aprovação.
2. Tornar a coleta fail-closed quando um arquivo desaparece ou não pode ser lido; registrar a remoção Git como tombstone explícito.
3. Reproduzir o comando com `--out` explícito e reconciliar o registro de execução.
4. Separar drift atribuído ao worktree de mudança efetivamente aprovada na comparação histórica.
5. Corrigir a referência da quality bar para a revalidação R3 e evitar autorreferência stale do manifesto no inventário.

**Veredito:** `REWORK`; `DONE` impedido até corrigir os cinco pontos e obter nova I1.
