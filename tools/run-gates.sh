#!/usr/bin/env bash
# AAA-16 authoritative gate commands (final revision).
# DB: cvg_aaa_aaa_20260912_a16 @ 127.0.0.1:56432 (marker aaa-20260912-a16, 23 migrations)
# Redis: 127.0.0.1:56687 (dedicated)
# NOTE: `pnpm test` exits 1 because 4 other-run guard suites reject this run's DB
# marker by design (C00). All runnable suites are green -- see RETORNO.md §6.
set -uo pipefail
cd /home/ricardo/cvg-connect-desk
OUT="${1:-/tmp/cvg-aaa-returns/aaa-16/raw/final}"
mkdir -p "$OUT/runnable"

export DATABASE_URL='postgresql://cvg_aaa@127.0.0.1:56432/cvg_aaa_aaa_20260912_a16'
export REDIS_URL='redis://127.0.0.1:56687'

pnpm install --frozen-lockfile > "$OUT/install-frozen.log" 2>&1; echo "exit=$?" > "$OUT/install-frozen.exit"

pnpm typecheck --force > "$OUT/macro-typecheck.log" 2>&1; echo "exit=$?" > "$OUT/macro-typecheck.exit"

pnpm lint --force > "$OUT/macro-lint.log" 2>&1; echo "exit=$?" > "$OUT/macro-lint.exit"

pnpm build --force > "$OUT/macro-build.log" 2>&1; echo "exit=$?" > "$OUT/macro-build.exit"

pnpm test --force > "$OUT/macro-test-withdb.log" 2>&1
echo "exit=$?" > "$OUT/macro-test-withdb.exit"

# --- 4 runnable suites (guard files of other runs excluded) ---
(
  cd apps/desk-api
  pnpm exec vitest run \
    --exclude 'src/__tests__/aaa-04.integration.test.ts' \
    --exclude 'src/__tests__/aaa-05.integration.test.ts' \
    --exclude 'src/__tests__/aaa-09.integration.test.ts' \
    --exclude 'src/__tests__/aaa-10.integration.test.ts' \
    --exclude 'src/__tests__/aaa-11.integration.test.ts' \
    --exclude 'src/__tests__/aaa-12.integration.test.ts' \
    --exclude 'src/__tests__/aaa-17.integration.test.ts' \
    --exclude 'src/__tests__/aaa-19.integration.test.ts'
) > "$OUT/runnable/desk-api.log" 2>&1; echo "exit=$?" > "$OUT/runnable/desk-api.exit"

pnpm --filter @cvg/chat exec vitest run \
  --exclude 'src/__tests__/aaa-08-atomicity.test.ts' \
  > "$OUT/runnable/chat.log" 2>&1; echo "exit=$?" > "$OUT/runnable/chat.exit"

pnpm --filter @cvg/events exec vitest run \
  --exclude 'src/__tests__/aaa-07-lease-real.test.ts' \
  > "$OUT/runnable/events.log" 2>&1; echo "exit=$?" > "$OUT/runnable/events.exit"

pnpm --filter @cvg/realtime-service exec vitest run \
  --exclude 'src/__tests__/aaa-05-isolation.test.ts' \
  > "$OUT/runnable/realtime-service.log" 2>&1; echo "exit=$?" > "$OUT/runnable/realtime-service.exit"
