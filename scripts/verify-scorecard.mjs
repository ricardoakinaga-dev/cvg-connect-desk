#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scorecardPath = resolve(process.cwd(), process.argv[2] || 'docs/95-scorecard.json');
const requiredItemCount = 18;
const minimumScore = 95;

if (!existsSync(scorecardPath)) {
  console.error(`Scorecard not found: ${scorecardPath}`);
  process.exit(1);
}

let scorecard;
try {
  scorecard = JSON.parse(readFileSync(scorecardPath, 'utf8'));
} catch (error) {
  console.error(`Invalid scorecard JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const failures = [];
if (scorecard?.baseline !== 74) failures.push('baseline must be 74');
if (scorecard?.target !== 95) failures.push('target must be 95');
if (!Array.isArray(scorecard?.items)) failures.push('items must be an array');

const items = Array.isArray(scorecard?.items) ? scorecard.items : [];
const ids = new Set();
if (items.length !== requiredItemCount) {
  failures.push(`expected ${requiredItemCount} items, received ${items.length}`);
}

for (const [index, item] of items.entries()) {
  const label = `item ${index + 1}`;
  if (!item || typeof item !== 'object') {
    failures.push(`${label} is not an object`);
    continue;
  }
  if (!item.id || typeof item.id !== 'string') failures.push(`${label} is missing id`);
  if (ids.has(item.id)) failures.push(`duplicate item id: ${item.id}`);
  ids.add(item.id);
  if (typeof item.score !== 'number' || item.score < minimumScore || item.score > 100) {
    failures.push(`${item.id || label} score must be between ${minimumScore} and 100`);
  }
  if (item.decision !== 'PASS') failures.push(`${item.id || label} decision must be PASS`);
  if (!item.command || typeof item.command !== 'string') failures.push(`${item.id || label} is missing command`);
  if (!item.executedAt || typeof item.executedAt !== 'string') failures.push(`${item.id || label} is missing executedAt`);
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    failures.push(`${item.id || label} must point to at least one evidence file`);
  } else {
    for (const evidencePath of item.evidence) {
      if (typeof evidencePath !== 'string' || !existsSync(resolve(process.cwd(), evidencePath))) {
        failures.push(`${item.id || label} evidence does not exist: ${evidencePath}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Scorecard verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Scorecard verified: ${items.length}/${requiredItemCount} items at or above ${minimumScore}/100.`);
