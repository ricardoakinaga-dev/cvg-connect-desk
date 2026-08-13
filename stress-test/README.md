# Stress Test - k6

V2: Stress Test for CVG Connect Desk

## Prerequisites

1. Install k6: https://k6.io/docs/getting-started/installation/
2. Running services:
   - PostgreSQL
   - desk-api (http://localhost:3000)
   - desk-web (http://localhost:4000)

## Running Tests

### Basic Stress Test (50-100 users)
```bash
bash stress-test/run-k6-stress.sh
```

> O runner usa `k6` local quando disponível e, se não estiver instalado, cai automaticamente para `docker run grafana/k6`.

As credenciais do cenário são configuráveis e não usam mais um administrador padrão inseguro:
```bash
TEST_EMAIL=e2e-admin@cvg.test TEST_PASSWORD='E2eSmokePass!2026' bash stress-test/run-k6-stress.sh
```

### With Custom Target URL
```bash
TARGET_URL=https://api.staging.example.com bash stress-test/run-k6-stress.sh
```

Você também pode sobrescrever o threshold de latência em cada execução:
```bash
P95_THRESHOLD_MS=500 bash stress-test/run-k6-stress.sh
```

O perfil padrão é `production`, com p95 alvo de 500ms. Para reproduzir o ciclo de QA em Docker local, use o perfil explícito:
```bash
QA_PERF_PROFILE=local-docker bash stress-test/run-k6-stress.sh
```

### Production Load Test
```bash
TARGET_URL=https://api.production.example.com bash stress-test/run-k6-stress.sh
```

## Test Scenarios

### Normal Load
- 50 concurrent users
- 1 minute sustained
- Validates p95 < configured threshold (padrão produção: 500ms; `local-docker`: 1500ms)

### Spike Load
- 100 concurrent users
- 1 minute sustained
- Validates system doesn't crash

### Acceptance Criteria
```
✅ Latency p95 < 500ms em produção/staging ou < 1500ms no perfil explícito local/QA Docker
✅ Error rate < 1%
✅ No race conditions
✅ System recovers after spike
```

## Metrics Collected

- `http_req_duration` - Request latency
- `http_req_failed` - Failed request rate
- `login_duration` - Login endpoint latency
- `message_send_duration` - Message sending latency
- `conversation_load_duration` - Conversation loading latency
- `errors` - Custom error rate

## Output Files

- `stress-test/summary.json` - `scenario_thresholds` + `summary` para validação rápida de execução
- stdout - Human-readable summary

## Integration with CI/CD

Add to your CI pipeline:

```yaml
stress-test:
  stage: performance
  script:
    - k6 run stress-test/k6-stress-test.js --env TARGET_URL=$API_URL
  artifacts:
    reports:
      json: stress-test/summary.json
```

## Notes

- Sempre forneça `TEST_EMAIL` e `TEST_PASSWORD` por ambiente/secret manager em staging/produção; o fallback existe apenas para a fixture local E2E.
- Increase iteration count for longer stress tests.
- Monitor database connections during test.
