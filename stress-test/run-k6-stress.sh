#!/usr/bin/env bash

set -euo pipefail

TARGET_URL=${TARGET_URL:-http://localhost:3000}
SUMMARY_PATH=${SUMMARY_PATH:-$(pwd)/stress-test/summary.json}
QA_PERF_PROFILE=${QA_PERF_PROFILE:-production}
if [ -z "${P95_THRESHOLD_MS:-}" ]; then
  if [ "$QA_PERF_PROFILE" = "local-docker" ]; then
    P95_THRESHOLD_MS=1500
  else
    P95_THRESHOLD_MS=500
  fi
fi
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$(dirname "$SUMMARY_PATH")"

# If k6 is not installed locally, fall back to Docker (grafana/k6).
if command -v k6 >/dev/null 2>&1; then
  k6 run stress-test/k6-stress-test.js \
    --env TARGET_URL="$TARGET_URL" \
    --env SUMMARY_PATH="$SUMMARY_PATH" \
    --env QA_PERF_PROFILE="$QA_PERF_PROFILE" \
    --env P95_THRESHOLD_MS="$P95_THRESHOLD_MS" \
    --env TEST_EMAIL="${TEST_EMAIL:-}" \
    --env TEST_PASSWORD="${TEST_PASSWORD:-}"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "k6 não encontrado e docker não disponível. Instale k6 ou Docker para continuar."
  exit 1
fi

if [[ "$SUMMARY_PATH" == "$PROJECT_ROOT"* ]]; then
  DOCKER_SUMMARY_PATH="/workspace/${SUMMARY_PATH#"$PROJECT_ROOT"/}"
else
  DOCKER_SUMMARY_PATH="/workspace/stress-test/summary.json"
fi

echo "k6 não encontrado localmente. Usando container Docker: grafana/k6"
docker run --rm \
  --network=host \
  --user "$(id -u):$(id -g)" \
  -v "$PROJECT_ROOT:/workspace" \
  -w /workspace \
  -e TARGET_URL="$TARGET_URL" \
  -e SUMMARY_PATH="$DOCKER_SUMMARY_PATH" \
  -e QA_PERF_PROFILE="$QA_PERF_PROFILE" \
  -e P95_THRESHOLD_MS="$P95_THRESHOLD_MS" \
  -e TEST_EMAIL="${TEST_EMAIL:-}" \
  -e TEST_PASSWORD="${TEST_PASSWORD:-}" \
  grafana/k6:latest \
  run stress-test/k6-stress-test.js
