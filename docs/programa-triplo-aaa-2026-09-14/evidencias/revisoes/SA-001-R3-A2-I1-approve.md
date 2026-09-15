# SA-001-R3-A2 — I1 independente

**Veredito:** APPROVE

**Revisor:** Halley (I1 independente, contexto fresco, somente leitura)  
**Revisado em:** 2026-09-15T13:26:25Z  
**Sentinel:** `/tmp/cvg-sa001-i1-r3-a2-pre.json`  
**Sentinel SHA256:** `1c35586b78ec74c492d21a2429a0cd53a1a7f507ab41dd57daef505550cee021`

## Candidato revisado

- Revisão: `754f9badac46278e77d21de91c58eedb15e80581`
- `candidate_id`: `754f9badac46278e77d21de91c58eedb15e80581+worktree#product-4ee19f2ec5ca8bff`
- `product_sha256`: `4ee19f2ec5ca8bffd550d2befc006a695bec89b5b3eeb8460e05146d61c8a52f`
- `ledger_sha256`: `7464625eb0c640ec2c7c7ef3ac57b1c01e47b2da8db60e825132665d6708dd0a`

## Decisão por aceite

- **AC1:** aprovado. O manifesto cobre configuração versionada, incluindo bytes de `.env.production.example` por digest, modo, symlink, adição, remoção unstaged e remoção staged com tombstone; falhas de Git/coleta são fail-closed; produto e livro-caixa têm selos separados e as evidências canônicas ficam fora do inventário bruto.
- **AC2:** aprovado. A revalidação apresenta A01–A10 exatamente uma vez, com 7 corrigidos, 2 parciais e 1 aberto; nenhum aceite foi removido ou promovido por texto.
- **AC3:** aprovado. Ambiente, ferramentas, executor, comandos com `--out`, hashes de 64 hexadecimais, limitações e histórico BASELINE/STALE estão registrados para o candidato atual.

## Regressão e limites

- `python3 -m unittest -q scripts/programa-triplo-aaa/test_candidate_manifest.py`: **8/8 PASS**, incluindo remoção staged/tombstone.
- `python3 docs/programa-triplo-aaa-2026-09-14/programa.py validate`: **valid: true**; validação estrutural, não certificação do produto.
- Comparação histórica: 49 alterações atribuídas ao worktree exigem review, 0 diferenças inexplicadas; drift não é apagado.
- Não é aprovação de G01/G12, A01–A10 produtores, release ou produto inteiro. O label nominal do manifesto continua `SA-001-R3-A1` por compatibilidade com a ação; o run documental corrente é `sa001-r3-a2-20260915`.

Este registro é posterior à última alteração do coletor e constitui a crítica I1 exigida para a promoção do SA-001.
