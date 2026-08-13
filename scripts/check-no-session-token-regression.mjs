#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const scanRoots = [
  'apps/desk-web/src',
  'apps/realtime-service/src',
];

const ignoredPathParts = new Set([
  '__tests__',
  'coverage',
  'dist',
  'node_modules',
]);

const sourceExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
]);

const checks = [
  {
    id: 'browser-token-storage',
    description: 'token de sessao em localStorage/sessionStorage',
    pattern: /\b(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|getItem|removeItem)\s*\(\s*['"`][^'"`]*(?:auth|session|token)/iu,
  },
  {
    id: 'web-realtime-bearer-header',
    description: 'Authorization/Bearer em fluxo web ou realtime',
    pattern: /\bAuthorization\b|Bearer\s+/iu,
  },
];

function shouldSkip(path) {
  const parts = path.split('/');
  if (parts.some((part) => ignoredPathParts.has(part))) {
    return true;
  }

  return /(?:^|[.-])(?:test|spec)\.[cm]?[jt]sx?$/u.test(path);
}

function extensionOf(path) {
  const match = path.match(/(\.[^.]+)$/u);
  return match ? match[1] : '';
}

function listSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const relativePath = relative(root, path);

    if (shouldSkip(relativePath)) {
      continue;
    }

    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }

    if (sourceExtensions.has(extensionOf(path))) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];

for (const scanRoot of scanRoots) {
  const absoluteRoot = join(root, scanRoot);
  for (const file of listSourceFiles(absoluteRoot)) {
    const content = readFileSync(file, 'utf8');
    for (const check of checks) {
      const match = content.match(check.pattern);
      if (match) {
        violations.push({
          check: check.id,
          description: check.description,
          file: relative(root, file),
          match: match[0],
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Security regression check failed: session token patterns were found.\n');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.description} (${violation.check})`);
    console.error(`  match: ${JSON.stringify(violation.match)}`);
  }
  process.exit(1);
}

console.log('Security regression check passed: no session token storage or Bearer auth in web/realtime sources.');
