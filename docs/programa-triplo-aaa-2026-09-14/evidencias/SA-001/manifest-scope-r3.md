# SA-001-R3-A1 — Contrato e resultado do manifesto

## Escopos

| Selo | Inclui | Exclui | Regra de identidade |
|---|---|---|---|
| `product_sha256` | Todo arquivo inventariado fora de `docs/programa-triplo-aaa-2026-09-14/` e `docs/auditorias/`, incluindo fontes, testes, Docker, lockfile, configurações e `.env*.example`. | Prefixos canônicos de programa/auditoria e diretórios gerados globais definidos pelo gerador. | SHA-256 de uma lista canônica de `path`, `kind`, `mode`, `sha256` e digest de destino de symlink. |
| `ledger_sha256` | Documentos canônicos sob os dois prefixos de controle. | `evidencias/`, `evidence/`, `artifacts/`, manifests derivados e source-manifest, evitando autorreferência. | Mesmo formato canônico, ligado ao mesmo `candidate.revision` do produto. |

O manifesto completo preserva a topologia do worktree: commit, branch, status, diff, arquivos rastreados/não rastreados, modo, tipo, symlink e hashes. O candidato usa `product_sha256` na identidade; `tree_sha256` é somente alias de compatibilidade histórica.

Os diretórios de evidências geradas dos dois prefixos de controle ficam fora do inventário bruto (`inventory.excluded_prefixes`) e são cobertos por artefatos individuais com hash. O caminho de saída do próprio manifesto também é excluído explicitamente (`inventory.excluded_paths`), evitando digest stale de si mesmo; essas exclusões não alteram os selos de produto/livro-caixa.

## Controles executados

`python3 -m unittest -v scripts/programa-triplo-aaa/test_candidate_manifest.py` cobre:

- known-good repetido com selos estáveis;
- mudança de bytes com o mesmo tamanho em `.env.production.example`;
- mutação de `docs/auditorias/` e do programa alterando somente o livro-caixa;
- mudança de modo, destino de symlink, adição staged, remoção unstaged e remoção staged com tombstone;
- adição staged visível no diff e inventário;
- falha de Git e desaparecimento de entrada fechados por exceção, sem manifesto vazio;
- ausência de conteúdo de segredo no JSON.

## Artefatos relacionados

- Manifesto corrente: `candidate-manifest-r3.json`.
- Comparação com a fonte histórica: `source-manifest-comparison-r3.json`.
- Revalidação explícita: `findings-revalidation-r3.md`.
- Ambiente e limitações: `environment-r3.json`.
- Barra congelada: `quality-bar-r3.json`.

Esta entrega corrige a identidade e a evidência do candidato; não reclassifica A01–A10, não fecha G01/G12 e não declara o produto pronto.
