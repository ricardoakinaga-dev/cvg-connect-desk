# Modelo de ameaças — revisão R3, 13/09/2026

Fronteiras: navegador/proxy/API, Gateway/Secretary, PostgreSQL/outbox/worker, Redis/WebSocket, storage/scanner, CI/registry e operadores. Resumo técnico observado; não representa certificação regulatória ou operacional.

| Ameaça | Controle observado | Lacuna / prova exigida |
|---|---|---|
| Sessão roubada/acesso cruzado | Sessões opacas com hash/deadlines, ação/recurso e revogação | Matriz integral HTTP/WS e legados; PROD05 atual bloqueado por boot |
| Webhook forjado/repetido | HMAC/skew e recibos; retry reassinado e ACK completed corrigidos | Prova HTTP+PG/crash e contrato provider oficial |
| Efeito perdido/repetido | Outbox, leases/dedup e unknown preservado | processing órfão ACKed, resultado IA/checkpoint/reconciliação |
| Mutação fora de escopo/política | Nova erasure com política e checkpoints | /anonymize legado ainda contorna núcleo; D02 |
| SSRF/malware/anexo exposto | Asset privado, validação, quarentena/scan e recovery ligado | Contenção de pool e storage/scanner/revogação reais |
| Escrita obsoleta | Locks e CAS quando fornecido | Versão obrigatória API/UI e conflito sem escrita |
| IA excedendo orçamento/autoridade | Budget persistente, tools deny-default | Reconciliação e ratificação D05 antes de efeitos |
| Indisponibilidade/telemetria ausente | Health/readiness e metrics com Bearer | Entry point realtime quebra no import; scrape/alerta real pendente |
| PII em logs/traces | Redaction/telemetria implementadas | Revisão recursiva e cadeia real completa |
| Release com evidência inválida | Gate corrigiu digest/comando/evento e queries vazias | Ainda aprova valores inválidos/budget/tempo e derivado sem run/attempt |
| Artefato diferente do testado | Scan/SBOM e workflows | Mesmos digests em build/scan/boot/E2E/promoção |
| Desastre/restauração indevida | Scripts de backup/restore | Namespaces seguros, checksum obrigatório, mídia/erasures e restore integral |

[Auditoria e fontes](auditorias/2026-09-13-r3/RELATORIO.md) · [Plano R3](melhorias-2026-09-13-r3/README.md). Resolução específica não dispensa controles integrados e decisões do responsável.
