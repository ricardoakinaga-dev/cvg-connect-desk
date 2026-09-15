# Pendências técnicas — revisão13/09/2026

**Estado: NOT_READY.** A [auditoria das entregas](auditorias/2026-09-13-entregas/RELATORIO.md) substitui conclusões anteriores de ausência de blockers. O [backlog R2](melhorias-2026-09-13/BACKLOG.md) é a fonte de execução.

| Frente | Pendência comprovada ou prova faltante | Encaminhamento |
|---|---|---|
| Gate/CI | Digest divergente, manifesto contraditório e queries vazias aceitos; política de evento e identidade de imagem incompletas | PROD02/03/34/35 |
| Privacidade | Rota legada não aplica política/escopo/checkpoints da nova erasure | PROD16 |
| Ingresso/IA | Retry reassinado rejeitado; unknown reaberto sem confirmação remota | PROD07/10/13 |
| Mídia | Recovery não conectado ao runtime e SCAN_FAILED fora do filtro | PROD14/15/32 |
| Concorrência | Precondição opcional nas operações e ausente no cliente | PROD18/19/27 |
| Produto | Contexto/ações/mídia/seletores/admin e atualização entre operadores incompletos | PROD19–30 |
| Operação | CI/imagens/OTel/carga/restore/a11y integrados sem prova atual suficiente | PROD31–40 |

Preservar avanços: autorização efetiva, recibos, worker assíncrono, budget persistente, pipeline privado, nova erasure, operações transacionais, auth bootstrap e health real. Outbox e DLQ são persistentes; OTel existe no código. Permanecem decisões D01–D06, limites de infraestrutura e autorização de release.
