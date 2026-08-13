import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const cwd = process.cwd();
const srcDir = join(cwd, 'src');

function collectSourceFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (['__tests__', 'dist', 'coverage', 'node_modules'].includes(entry.name)) {
        continue;
      }
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
  console.log('verify-package-source: no src directory, nothing to validate.');
  process.exit(0);
}

const files = collectSourceFiles(srcDir);
let hasErrors = false;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });

  const diagnostics = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  if (diagnostics.length === 0) {
    continue;
  }

  hasErrors = true;
  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const position = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : null;
    const location = position
      ? `${relative(cwd, file)}:${position.line + 1}:${position.character + 1}`
      : relative(cwd, file);
    console.error(`${location} - TS${diagnostic.code}: ${message}`);
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`verify-package-source: validated ${files.length} TypeScript source files.`);
