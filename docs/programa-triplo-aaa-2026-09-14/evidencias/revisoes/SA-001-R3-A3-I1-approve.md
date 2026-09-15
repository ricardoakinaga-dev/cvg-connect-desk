# SA-001-R3-A3 — I1 independente

**Veredito:** APPROVE

**Revisor:** Mill (I1 independente, contexto fresco, somente leitura)  
**Revisado em:** 2026-09-15T13:43:00Z  
**Sentinel:** `/tmp/cvg-sa001-i1-r3-a3-pre.json`  
**Fingerprint do candidato:** `193be880150a525ed58f61d2c2d171c8546501cbb8b3f9acefd2f65d35d66d86`  
**SHA256 do sentinel:** `797830a2701f7b706576cdbef7b0c4eca7b3b19778646f7800593035ce9bf09a`

## Candidato revisado

- Revisão: `754f9badac46278e77d21de91c58eedb15e80581`
- `candidate_id`: `754f9badac46278e77d21de91c58eedb15e80581+worktree#product-4ee19f2ec5ca8bff`
- `product_sha256`: `4ee19f2ec5ca8bffd550d2befc006a695bec89b5b3eeb8460e05146d61c8a52f`
- `ledger_sha256`: `9fec5ce21deea42de53266ae436e2ed04e5393dc101d712acfce7548096adc49`
- Estado canônico conferido: `SA-001 DONE`, evidência `CURRENT`; programa `1 DONE / 18 REWORK / 44 PLANNED`.

## Decisão por aceite

- **AC1:** aprovado. Configuração versionada, incluindo bytes de `.env.production.example` por digest, modos, symlink, adição, alteração unstaged, remoção unstaged e remoção staged com tombstone; falhas de Git/coleta são fail-closed; produto e livro-caixa têm selos separados e as evidências canônicas ficam fora do inventário bruto.
- **AC2:** aprovado. A revalidação apresenta A01–A10 exatamente uma vez, com 7 corrigidos, 2 parciais e 1 aberto; nenhum aceite foi removido ou promovido por texto.
- **AC3:** aprovado. Ambiente, ferramentas, executor, comandos com `--out`, hashes de 64 hexadecimais, cronologia e histórico BASELINE/STALE estão registrados para o candidato pós-promoção.

## Regressão e limites

- `python3 -m unittest -q scripts/programa-triplo-aaa/test_candidate_manifest.py`: **8/8 PASS**, exit 0, incluindo remoção staged/tombstone.
- `python3 docs/programa-triplo-aaa-2026-09-14/programa.py validate`: **valid: true**; validação estrutural, não certificação do produto.
- Comparação histórica: 49 alterações atribuídas ao worktree exigem review, 0 diferenças inexplicadas e 7 caminhos baseline/stale; drift permanece `review_required`.
- Não é aprovação de G01/G12, A01–A10 produtores, release ou produto inteiro. O produto continua `NOT_READY`; a aprovação encerra apenas a identidade/evidência de SA-001.

O sentinel permaneceu íntegro durante toda a crítica. O `review_ref` foi reservado antes da I1, fica sob `evidencias/` e não participa do `ledger_sha256`; seu conteúdo final registra este veredito.
