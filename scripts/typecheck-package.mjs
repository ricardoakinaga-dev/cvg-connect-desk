#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = process.cwd();
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fastifyOpenApiSchemaTypes = join(repoRoot, 'packages/shared/src/fastify-openapi-schema.ts');
const runtimeSourcesOnly = process.argv.includes('--runtime-sources');

function collectTypeScriptFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage', '__tests__'].includes(entry)) {
        continue;
      }
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }

    if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts')) {
      files.push(relative(cwd, fullPath));
    }
  }

  return files;
}

if (existsSync(join(cwd, 'tsconfig.json')) && !runtimeSourcesOnly) {
  const result = spawnSync('pnpm', ['exec', 'tsc', '--noEmit'], {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  process.exit(result.status ?? 1);
}

const sourceFiles = [
  fastifyOpenApiSchemaTypes,
  ...collectTypeScriptFiles(join(cwd, 'src')),
];

if (existsSync(join(cwd, 'index.ts'))) {
  sourceFiles.push('index.ts');
}

if (sourceFiles.length === 0) {
  console.log('typecheck-package: no TypeScript runtime sources, nothing to validate.');
  process.exit(0);
}

const result = spawnSync('pnpm', [
  'exec',
  'tsc',
  '--noEmit',
  '--target',
  'ES2022',
  '--module',
  'ESNext',
  '--moduleResolution',
  'Bundler',
  '--lib',
  'ES2022,DOM,DOM.Iterable',
  '--jsx',
  'react-jsx',
  '--strict',
  'true',
  '--strictFunctionTypes',
  'false',
  '--noImplicitReturns',
  'false',
  '--noFallthroughCasesInSwitch',
  '--allowImportingTsExtensions',
  '--esModuleInterop',
  '--skipLibCheck',
  '--forceConsistentCasingInFileNames',
  '--types',
  'node',
  ...sourceFiles,
], {
  cwd,
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
