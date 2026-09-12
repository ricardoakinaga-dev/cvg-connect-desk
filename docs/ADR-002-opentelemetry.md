# ADR-002 — OpenTelemetry

- Status: accepted. Data: 2026.
- Contexto: correlação ponta-a-ponta inexistente (só correlation_id em logs).
- Decisão: SDK oficial (`@cvg/tracing`), OTLP via env, noop por padrão; W3C traceparent em Secretary (fetch) e gateway (axios); spans `webhook.receive`, `secretary.invoke`, `gateway.send`, `worker.process`, `realtime.publish`; attributes sem PII (`safeAttributes`); outbox carrega correlation IDs como ponte.
- Alternativas: vendor APM (lock-in, custo); logs-only (insuficiente p/ latência distribuída).
- Consequências: +6 deps OTEL; overhead desprezível com noop; amostragem delegada ao Collector.
- Segurança: nenhum segredo/PII em attributes (testado); OTLP headers via env (não commitados).
- Operacional: dashboards de latência por span; SLOs de P95 passam a ser mensuráveis em prod.
