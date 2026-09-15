# Apoio AAA-06 — endereço de realtime na implantação web

- Status: **DELIVERED** (preparação; AAA-06 **não** implementada, **não** despachada).
- Autor: Agente 2 (preparação), a pedido do coordenador, 2026-09-12.
- Base: `754f9badac46278e77d21de91c58eedb15e80581`.
- Cartão: `docs/execucao-aaa-2026-09-12/tasks/AAA-06.md` (A05). Contratos declarados: **C02 (congelado, `b96ebc60…`)** e **C08 (AUSENTE em `runtime/contracts/`; só C01–C03 congelados)**.
- Escrita desta preparação: somente `docs/execucao-aaa-2026-09-12/acompanhamento/apoio-AAA-06/**` (produto/runtime/compose não foram alterados).

## Índice

| Documento | Conteúdo |
|---|---|
| [01-DIAGNOSTICO.md](01-DIAGNOSTICO.md) | Rastreamento dev → build → proxy; onde `localhost`/protocolo errado chegam ao navegador; evidências e hashes |
| [02-PROPOSTA-SOLUCAO.md](02-PROPOSTA-SOLUCAO.md) | Solução de origem pública + `/ws` + `ws/wss`; proposta de diff (não aplicada) e compatibilidade |
| [03-TESTES.md](03-TESTES.md) | Matriz de testes unitários e e2e; harness/ambiente isolado; critérios verificáveis |
| [04-CONTRATO-C08-RECORTE.md](04-CONTRATO-C08-RECORTE.md) | Recorte contratual proposto para o coordenador (C08 ausente) |
| [05-DESPACHO-RASCUNHO.md](05-DESPACHO-RASCUNHO.md) | Minuta de despacho com ownership, locks, escopo e aceite |
| [06-PENDENCIAS.md](06-PENDENCIAS.md) | Pendências exatas para implementar |
| `hashes-baseline.txt` | SHA-256 dos arquivos do diagnóstico |

## Conclusão executiva

1. O bundle de produção recebe, em build, `VITE_REALTIME_URL=ws://localhost:8080` (default do `Dockerfile`), pois o Compose não passa esse argumento. Qualquer navegador remoto tenta o **próprio** localhost; em HTTPS, `ws://` é bloqueado por mixed content.
2. O proxy `/ws/` já existe no nginx e o `realtime-service` aceita qualquer path (`WebSocketServer({ port })`), mas o default absoluto o ignora.
3. Solução mínima e compatível: precedência `baseUrl` → `VITE_REALTIME_URL` (absoluto ou path) → **mesma origem `ws(s)://<host>/ws/`**, com default de imagem `/ws/` e argumento explícito no Compose; testes unitários para origem/protocolo e e2e para origem remota + reconexão.
4. Bloqueios de implementação: **C08 ausente** (recorte proposto) e **despacho/ownership ausentes** (minuta pronta).
