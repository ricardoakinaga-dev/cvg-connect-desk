# SLO — CVG Connect Desk

## Objetivos iniciais

| SLO | Alvo | Métrica |
|---|---|---|
| Disponibilidade API | ≥ 99,9% | `up(http_requests_total)` / probes `/health` |
| Webhook crítico | ≥ 99,95% | `webhook_requests_total{decision="signature_valid"}` vs 5xx |
| Perda de mensagem | 0 tolerada | redelivery at-least-once + reconciliação (testes `resilience.*`) |
| Efeito colateral duplicado | < 0,001% | `messages_outbound_total{deduplicated="true"}` / total |
| Persistência inbound P95 | < 250 ms | `http_request_duration_seconds{route="/webhook/inbound"}` |
| Propagação realtime P95 | < 500 ms | medição ponta-a-ponta (a instrumentar) |

## Error budgets

- API: 0,1% (~43 min/mês). Queima rápida (1h) → página; lenta (6h) → ticket.
- Webhook: 0,05%. Qualquer 5xx em `/webhook/inbound` com `WEBHOOK_SECRET` OK = incidente.

## Metodologia

Burn-rate sobre janelas 1h/6h. Evidência atual: k6 smoke (`e2e/load/smoke-load.js`, 10 VUs, p95 6,7 ms em leitura+webhook local).
Metas de produção exigem baseline em ambiente real antes de apertar thresholds.

## Não-SLO (documentado)

Latência do Secretary/IA: best-effort com timeout 30s + retry limitado; atendimento humano não depende dele.
