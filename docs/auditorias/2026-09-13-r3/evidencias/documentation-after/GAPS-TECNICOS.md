# Pendências técnicas — revisão R3, 13/09/2026

**NOT_READY.** [Auditoria atual](auditorias/2026-09-13-r3/RELATORIO.md) e [backlog R3](melhorias-2026-09-13-r3/BACKLOG.md) são a referência de continuidade.

| Frente | Pendência atual | Encaminhamento |
|---|---|---|
| Bootstrap realtime | Named export metrics quebra entrypoint nativo; PROD05 não executa17 casos | PROD-44,05,34,36 |
| Gate/CI | Números nulos/acima do budget/futuros e artefato derivado sem run/attempt recebem PASS; imagem entregue ainda não vinculada integralmente | PROD-02,03,33,35 |
| Privacidade | /anonymize legado contorna política e escopo do núcleo | PROD-16 |
| IA e crash | processing órfão pode receber ACK sem checkpoint/reconciliação | PROD-10,12,13 |
| Mídia | Recovery ligado, mas risco de auto-saturação do pool; origem expirada e scanner/storage reais pendentes | PROD-14,15,32 |
| Concorrência | Versão opcional nas operações e ausente na UI | PROD-18,19,27 |
| Interface | FE01–17 abertos: drawer/foco, contexto/ações, timeline/mídia, vínculos/seletores/admin e atualização entre operadores | PROD-19–30,38 |
| Operação | Smoke/DR inseguros ou incompletos; imagens, scrape/alertas, carga, SIGKILL físico e E2E real sem prova suficiente | PROD-31–40 |
| Governança | D01–D06 abertas, atualização de backlog por execução e certificação final pendentes | PROD-00,01,39–43 |

Correções específicas confirmadas: retry com assinatura renovada, ACK2xx de completed, digest divergente, contradição comando/exit/log e evento desconhecido. Queries vazias já são recusadas. Baseline PROD00 atual42/42 hashes corresponde; não repetir o drift antigo. Handler de métricas está protegido e wiring Compose/Prometheus existe; falha de boot e falta de scrape impedem considerar observabilidade operacional concluída.

Preservar demais entregas: sessões opacas, autorização efetiva, outbox/DLQ persistentes, pipeline privado, nova erasure, operações transacionais, auth bootstrap web e health do processo/loop.
