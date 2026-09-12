# ADR-005 — Realtime Fanout (Redis Pub/Sub)

- Status: accepted. Data: 2026.
- Contexto: fan-out puramente local (single-replica); polling 500ms como única via.
- Decisão: Redis Pub/Sub como FAST path + polling do outbox como path DURÁVEL (se Redis cai, próximo poll entrega — latência degradada, nunca perda). `instanceId` por réplica, sem eco próprio, dedup de broadcast (60s, cap 2000). Streams rejeitado: não precisamos de consumer groups/persistência no bus (outbox já é o log durável).
- Consequências: +1 dep (`redis`); graceful shutdown drena bus+sockets; sem Redis o sistema opera como antes (NoopBus).
- Segurança: canal interno (rede `internal`); sem PII nova no canal (envelopes já existentes).
- Operacional: `realtime.publish` com span; teste two-instance real (A↔B + sem duplicata).
