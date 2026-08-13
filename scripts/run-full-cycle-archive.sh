#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_TS="${QA_RUN_TS:-$(date +'%Y%m%d-%H%M%S')}"
RUN_DATE="${QA_RUN_DATE:-$(date '+%Y-%m-%d')}"
RUN_SUMMARY_PATH="${SUMMARY_PATH:-$ROOT_DIR/stress-test/summary.json}"
EVIDENCE_DIR="${QA_EVIDENCE_DIR:-$ROOT_DIR/qa-runs}"
DOC_LOG_PATH="${QA_DOC_LOG:-$ROOT_DIR/docs/qa-full-cycle-log.md}"
QA_PERF_PROFILE="${QA_PERF_PROFILE:-production}"
if [ -z "${QA_P95_THRESHOLD_MS:-}" ]; then
  if [ "$QA_PERF_PROFILE" = "local-docker" ]; then
    ARCHIVE_P95_THRESHOLD_MS=1500
  else
    ARCHIVE_P95_THRESHOLD_MS=500
  fi
else
  ARCHIVE_P95_THRESHOLD_MS="$QA_P95_THRESHOLD_MS"
fi

mkdir -p "$EVIDENCE_DIR"
RUN_DIR="$EVIDENCE_DIR/$RUN_TS"
mkdir -p "$RUN_DIR"

LOG_PATH="$RUN_DIR/qa-full-cycle.log"
ARCHIVED_SUMMARY_PATH="$RUN_DIR/summary.json"
SCENARIO_STATUS="N/A"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_PATH"
}

extract_scenario_status() {
  local payload="$1"
  local parser="$2"

  if [ "$parser" = "jq" ] && command -v jq >/dev/null 2>&1; then
    jq -r '(.scenario_thresholds.scenario_passed // "N/A") | tostring' "$payload"
    return
  fi

  node - "$payload" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!payload || !payload.scenario_thresholds || typeof payload.scenario_thresholds.scenario_passed === 'undefined') {
  process.exit(1);
}
console.log(String(payload.scenario_thresholds.scenario_passed));
NODE
}

extract_summary_threshold() {
  local payload="$1"
  local fallback="${2:-$ARCHIVE_P95_THRESHOLD_MS}"
  local threshold=""

  if [ ! -f "$payload" ]; then
    printf '%s\n' "$fallback"
    return 0
  fi

  if command -v jq >/dev/null 2>&1; then
    threshold="$(jq -r '.scenario_thresholds.duration_p95_ms.threshold // empty' "$payload" 2>/dev/null || true)"
  fi

  if [ -z "$threshold" ] || [ "$threshold" = "null" ]; then
    threshold="$(node - "$payload" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
let threshold = '';
try {
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  const value = payload?.scenario_thresholds?.duration_p95_ms?.threshold;
  if (typeof value === 'number' && Number.isFinite(value)) {
    threshold = String(value);
  }
} catch (_) {}
process.stdout.write(threshold);
NODE
)"
  fi

  if [ -z "$threshold" ] || [ "$threshold" = "null" ]; then
    printf '%s\n' "$fallback"
    return 0
  fi

  printf '%s\n' "$threshold"
}

append_run_metadata_log() {
  local cycle_status="$1"
  local summary_path="$2"
  local effective_threshold="$3"

  log "=== Run metadata (JSON) ==="
  ARCHIVE_METADATA_JSON="$(RUN_SUMMARY_PATH_FOR_METADATA=\"$summary_path\" \
    RUN_TS=\"$RUN_TS\" \
    RUN_DATE=\"$RUN_DATE\" \
    CYCLE_STATUS_FOR_METADATA=\"$cycle_status\" \
    SCENARIO_STATUS_FOR_METADATA=\"$SCENARIO_STATUS\" \
    ARCHIVE_P95_THRESHOLD_MS=\"$ARCHIVE_P95_THRESHOLD_MS\" \
    ARCHIVE_EFFECTIVE_THRESHOLD_MS=\"$effective_threshold\" \
    LOG_PATH=\"$LOG_PATH\" \
    ARCHIVED_SUMMARY_PATH=\"$ARCHIVED_SUMMARY_PATH\" \
    node <<'NODE'
const path = process.env.RUN_SUMMARY_PATH_FOR_METADATA || '';
const cycleStatus = Number(process.env.CYCLE_STATUS_FOR_METADATA || 1);
const scenarioRaw = process.env.SCENARIO_STATUS_FOR_METADATA || 'N/A';
const scenarioPassed = scenarioRaw === 'true' ? true : (scenarioRaw === 'false' ? false : scenarioRaw);
const parseNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

let summaryPayload = {};
try {
  const fs = require('fs');
  if (path && fs.existsSync(path)) {
    summaryPayload = JSON.parse(fs.readFileSync(path, 'utf8'));
  }
} catch (_) {
  summaryPayload = {};
}

const archiveMetadata = {
  qa_full_cycle_archive: {
    archive_run_ts: process.env.RUN_TS,
    archive_run_date: process.env.RUN_DATE,
    qa_p95_threshold_ms: parseNumber(process.env.ARCHIVE_P95_THRESHOLD_MS),
    effective_p95_threshold_ms: parseNumber(process.env.ARCHIVE_EFFECTIVE_THRESHOLD_MS),
    cycle_status_code: cycleStatus,
    scenario_passed: scenarioPassed,
    command: 'pnpm run qa:full-cycle:archive',
    log_path: process.env.LOG_PATH,
    summary_path: process.env.ARCHIVED_SUMMARY_PATH,
    scenario_thresholds: summaryPayload?.scenario_thresholds || null,
    executed_at: new Date().toISOString(),
  },
};

console.log(JSON.stringify(archiveMetadata, null, 2));
NODE
)"

  printf '%s\n' "$ARCHIVE_METADATA_JSON" >> "$LOG_PATH"
}

run_cycle() {
  log "Iniciando ciclo de evidência QA em $RUN_TS"
  log "Log: $LOG_PATH"
  log "Summary de saída alvo: $RUN_SUMMARY_PATH"
  log "p95 threshold de stress do archive: ${ARCHIVE_P95_THRESHOLD_MS}ms"

  set +e
  QA_PERF_PROFILE="$QA_PERF_PROFILE" P95_THRESHOLD_MS="$ARCHIVE_P95_THRESHOLD_MS" pnpm run qa:full-cycle 2>&1 | tee -a "$LOG_PATH"
  local cycle_status="${PIPESTATUS[0]}"
  set -e

  if [ -f "$RUN_SUMMARY_PATH" ]; then
    cp "$RUN_SUMMARY_PATH" "$ARCHIVED_SUMMARY_PATH"
  fi

  if [ -f "$RUN_SUMMARY_PATH" ]; then
    SCENARIO_STATUS="$(extract_scenario_status "$RUN_SUMMARY_PATH" "jq" || true)"
    if [ -z "$SCENARIO_STATUS" ] || [ "$SCENARIO_STATUS" = "N/A" ]; then
      SCENARIO_STATUS="$(extract_scenario_status "$RUN_SUMMARY_PATH" "node" || true)"
    fi
    [ -z "$SCENARIO_STATUS" ] && SCENARIO_STATUS="N/A"
  fi

  log "Execução concluída com status=$cycle_status; scenario_passed=$SCENARIO_STATUS"
  log "Arquivo de evidência salvo em: $RUN_DIR"

  local effective_threshold
  effective_threshold="$(extract_summary_threshold "$RUN_SUMMARY_PATH")"

  append_run_metadata_log "$cycle_status" "$RUN_SUMMARY_PATH" "$effective_threshold"

  append_audit_entry "$cycle_status"
  return "$cycle_status"
}

append_audit_entry() {
  local cycle_status="$1"
  local markdown_status="❌ FAIL"
  local evidence_rel="${RUN_DIR#"$ROOT_DIR/"}"
  local log_rel="$evidence_rel/qa-full-cycle.log"
  local summary_rel="$evidence_rel/summary.json"

  if [ "$cycle_status" -eq 0 ]; then
    markdown_status="✅ PASS"
  fi

  if [ ! -f "$DOC_LOG_PATH" ]; then
    cat <<'HEADER' > "$DOC_LOG_PATH"
# QA Full-cycle Log

Registro objetivo de execuções do comando `pnpm run qa:full-cycle`.

| Data/Hora | Status | scenario_passed | Log | Summary |
|---|---|---|---|---|
HEADER
  fi

  {
    printf '\n| %s %s | %s | %s | `%s` | `%s` |\n' \
      "$RUN_DATE" "$RUN_TS" \
      "$markdown_status" \
      "$SCENARIO_STATUS" \
      "$log_rel" \
      "$summary_rel"
  } >> "$DOC_LOG_PATH"
}

run_cycle
