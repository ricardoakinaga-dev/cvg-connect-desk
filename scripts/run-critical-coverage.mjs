#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const minimumStatements = Number(process.env.CRITICAL_COVERAGE_STATEMENTS || 90);
const minimumBranches = Number(process.env.CRITICAL_COVERAGE_BRANCHES || 80);
const minimumFunctions = Number(process.env.CRITICAL_COVERAGE_FUNCTIONS || 80);

const packages = [
  { name: '@cvg/desk-api', path: 'apps/desk-api' },
  { name: '@cvg/chat', path: 'modules/chat' },
  { name: '@cvg/auth', path: 'packages/auth' },
  { name: '@cvg/events', path: 'packages/events' },
  { name: '@cvg/tasks', path: 'modules/tasks' },
  { name: '@cvg/desk-web', path: 'apps/desk-web' },
];

function runCoverage(packageName) {
  const packagePath = packages.find((pkg) => pkg.name === packageName)?.path;
  if (!packagePath) {
    throw new Error(`Unknown coverage package: ${packageName}`);
  }

  const testReportPath = join(process.cwd(), packagePath, 'coverage', 'test-results.json');
  mkdirSync(join(process.cwd(), packagePath, 'coverage'), { recursive: true });
  const result = spawnSync('pnpm', [
    '--filter',
    packageName,
    'exec',
    'vitest',
    'run',
    '--reporter=json',
    '--outputFile',
    testReportPath,
    '--coverage',
    '--coverage.reporter=json',
    '--coverage.reporter=json-summary',
    '--coverage.reporter=text',
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });

  return {
    status: result.status ?? 1,
    testReportPath,
  };
}

function countSkippedTests(value) {
  if (!value || typeof value !== 'object') {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countSkippedTests(item), 0);
  }

  const ownStatus = value.status;
  const ownSkipped = ownStatus === 'skipped' || ownStatus === 'pending' || ownStatus === 'todo' ? 1 : 0;
  return ownSkipped + Object.entries(value)
    .filter(([key]) => key !== 'status')
    .reduce((total, [, child]) => total + countSkippedTests(child), 0);
}

function readTestReport(testReportPath) {
  if (!existsSync(testReportPath)) {
    return { skipped: null };
  }

  const report = JSON.parse(readFileSync(testReportPath, 'utf8'));
  const declaredSkipped = [
    report?.numPendingTests,
    report?.numTodoTests,
    report?.numSkippedTests,
  ].reduce((max, value) => (typeof value === 'number' ? Math.max(max, value) : max), 0);
  const nestedSkipped = countSkippedTests(report?.testResults ?? report);

  return { skipped: Math.max(declaredSkipped, nestedSkipped) };
}

function readCoverage(packagePath) {
  const summaryPath = join(process.cwd(), packagePath, 'coverage', 'coverage-summary.json');
  if (!existsSync(summaryPath)) {
    throw new Error(`Coverage summary not found: ${summaryPath}`);
  }

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const coverage = {
    statements: summary?.total?.statements?.pct,
    branches: summary?.total?.branches?.pct,
    functions: summary?.total?.functions?.pct,
  };
  if (Object.values(coverage).some((pct) => typeof pct !== 'number')) {
    throw new Error(`Coverage summary missing statements/branches/functions percentages: ${summaryPath}`);
  }

  return coverage;
}

const results = [];
let failed = false;

for (const pkg of packages) {
  const run = runCoverage(pkg.name);
  const testReport = readTestReport(run.testReportPath);
  if (run.status !== 0) {
    failed = true;
    results.push({ ...pkg, statements: null, passed: false, reason: `test command exited ${run.status}` });
    continue;
  }

  const coverage = readCoverage(pkg.path);
  const hasNoSkippedTests = testReport.skipped === 0;
  const passed = hasNoSkippedTests
    && coverage.statements >= minimumStatements
    && coverage.branches >= minimumBranches
    && coverage.functions >= minimumFunctions;
  if (!passed) {
    failed = true;
  }
  const reason = testReport.skipped === null
    ? 'test report missing; skipped-test gate cannot be proven'
    : testReport.skipped > 0
      ? `${testReport.skipped} skipped/pending tests`
      : undefined;
  results.push({ ...pkg, ...coverage, skipped: testReport.skipped, passed, reason });
}

console.log('\nCritical coverage threshold report');
console.log(`Minimum statements: ${minimumStatements}%`);
console.log(`Minimum branches: ${minimumBranches}%`);
console.log(`Minimum functions: ${minimumFunctions}%`);
for (const result of results) {
  const statements = result.statements === null ? 'n/a' : `${result.statements.toFixed(2)}%`;
  const branches = result.branches === undefined ? 'n/a' : `${result.branches.toFixed(2)}%`;
  const functions = result.functions === undefined ? 'n/a' : `${result.functions.toFixed(2)}%`;
  const status = result.passed ? 'PASS' : 'FAIL';
  const reason = result.reason ? ` (${result.reason})` : '';
  const skipped = result.skipped === undefined || result.skipped === null ? 'n/a' : result.skipped;
  console.log(`${status} ${result.name}: statements ${statements}, branches ${branches}, functions ${functions}, skipped ${skipped}${reason}`);
}

if (failed) {
  process.exit(1);
}
