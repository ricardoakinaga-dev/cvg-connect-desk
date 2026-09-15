# Modelo de ameaças — estado auditado13/09/2026

Fronteiras: navegador/proxy/API, Gateway/Secretary, PostgreSQL/outbox/worker, Redis/WebSocket, storage/scanner, CI/registry e operadores. Este é um resumo técnico; não representa aprovação regulatória ou operacional.

| Ameaça | Controle observado | Lacuna / prova necessária |
|---|---|---|
| Sessão roubada ou acesso cruzado | Token opaco com hash, deadlines, ação/recurso e revogação | Matriz atual HTTP/WS e todos os endpoints, inclusive legados |
| Webhook forjado/repetido | HMAC/skew e recibo claim/complete/fail | Retry reassinado e resposta idempotente precisam contrato coerente |
| Efeito repetido/perdido sob crash | Outbox, leases, dedup, transações e DLQ persistente | unknown da IA, lease longo e confirmação de provider |
| Mutação de dados fora da política/escopo | Nova erasure com política e checkpoints | /anonymize legado contorna o núcleo; prioridade de correção |
| SSRF, malware e exposição de anexos | Validação, asset privado e quarentena/scan | Recovery de mídia e storage/scanner representativos ponta a ponta |
| Escrita concorrente perdida | Locks e CAS quando fornecido | Exigir precondição entre DTO/API/UI e tratar conflito |
| IA excedendo orçamento/autoridade | Admissão persistente e tools desabilitadas por padrão | Reconciliação de unknown; D05 e aprovadores necessários para ativar |
| PII em logs/traces | Redaction e telemetria implementadas | Revisão recursiva e prova real de toda cadeia |
| Release com evidência falsa | Gate/manifests e jobs requeridos | Adversariais demonstram falsos PASS; digest e payload precisam validação |
| Supply chain / imagem diferente da testada | Workflows de scan/SBOM e builds | Vincular mesmos manifest digests a scan/boot/E2E/promoção |
| Desastre / restauração indevida | Scripts de backup/restore disponíveis | Namespaces, checksum obrigatório, integridade de todas cópias, mídia e erasures |

DLQ e outbox não são apenas memória; OTel SDK existe e o Compose transmite configuração. Esses controles não eliminam as lacunas acima. Detalhes e evidências na [auditoria](auditorias/2026-09-13-entregas/RELATORIO.md); decisões e execução no [programa R2](melhorias-2026-09-13/README.md).
