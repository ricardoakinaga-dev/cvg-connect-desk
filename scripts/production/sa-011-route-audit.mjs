// SA-011/AC1 — inventário reproduzível de rotas e auditoria de validação.
//
// Uso: node scripts/production/sa-011-route-audit.mjs [--out caminho.json]
//
// Percorre os controllers HTTP, extrai registros `app.<método>(` com o caminho
// literal e verifica se o registro declara `schema:` (validação de entrada) e
// se o arquivo de apresentação faz escrita direta em repositório (possível
// contorno de caso de uso transacional).
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;

const roots = ['apps', 'modules', 'packages'];
const controllers = [];
// Registros inline no bootstrap (ex.: /events/:eventId/ack) não vivem em
// presentation/http/*; incluir o app.ts evita ponto cego no inventário.
const EXTRA_ROUTE_FILES = ['apps/desk-api/src/app.ts'].map((rel) => join(repoRoot, rel));
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/presentation\/http\/.*\.ts$/.test(full) && !full.endsWith('.d.ts') && !/__tests__/.test(full)) controllers.push(full);
  }
}
for (const root of roots) walk(join(repoRoot, root));
for (const file of EXTRA_ROUTE_FILES) {
  if (!controllers.includes(file) && statSync(file).isFile()) controllers.push(file);
}

const ROUTE_RE = /app\.(get|post|put|patch|delete|head|options)(?:<[^>]*>)?\s*\(\s*(?:\n\s*)?['"`]([^'"`]+)['"`]/g;
const VALIDATION_METHODS = new Set(['post', 'put', 'patch']);
const WRITE_RE = /\b\w*[Rr]epository\.(create|update|delete|insert|assign|transition|accept|reject|close|move)\w*\s*\(/g;

// Quais pacotes de workspace são dependências de algum app? Rotas de pacotes
// não registrados (código morto) não entram na contagem nem na allowlist.
const registeredPackages = new Set();
function collectAppDependencies() {
  const appsDir = join(repoRoot, 'apps');
  for (const app of readdirSync(appsDir)) {
    const manifestPath = join(appsDir, app, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      for (const name of Object.keys(manifest.dependencies ?? {})) registeredPackages.add(name);
      for (const name of Object.keys(manifest.devDependencies ?? {})) registeredPackages.add(name);
    } catch {
      // app sem manifesto: ignora
    }
  }
}
collectAppDependencies();

function packageNameFor(file) {
  let dir = file;
  for (let depth = 0; depth < 6; depth += 1) {
    dir = join(dir, '..');
    const manifestPath = join(dir, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name) return manifest.name;
    } catch {
      // continua subindo
    }
  }
  return null;
}

function extractRoutes(content, rel, pkg, registered) {
  const found = [];
  for (const match of content.matchAll(ROUTE_RE)) {
    const [full, method, path] = match;
    const start = match.index ?? 0;
    const windowEnd = content.indexOf('app.', start + full.length);
    const windowText = content.slice(start, windowEnd === -1 ? Math.min(content.length, start + 4000) : Math.min(windowEnd, start + 4000));
    found.push({
      file: rel,
      package: pkg,
      registered,
      method: method.toUpperCase(),
      path,
      hasSchema: /\bschema\s*:/.test(windowText),
      hasBodySchema: /body\s*:\s*\{/.test(windowText),
      hasQuerySchema: /querystring\s*:\s*\{/.test(windowText),
      hasParamsSchema: /params\s*:\s*\{/.test(windowText),
      methodExpectsValidation: VALIDATION_METHODS.has(method),
    });
  }
  return found;
}

// Controle negativo do próprio detector: uma mutação COM schema não pode ser
// marcada e uma SEM schema precisa ser marcada.
if (process.argv.includes('--self-test')) {
  const sample = `
    app.post('/fixture/with-schema', { schema: { body: { type: 'object' } } }, async () => {});
    app.post('/fixture/no-schema', { preHandler: [] }, async () => {});
  `;
  const detected = extractRoutes(sample, 'fixture.ts', 'fixture', true);
  const withSchema = detected.find((route) => route.path === '/fixture/with-schema');
  const noSchema = detected.find((route) => route.path === '/fixture/no-schema');
  const ok = Boolean(withSchema?.hasSchema) && Boolean(noSchema) && noSchema.hasSchema === false;
  console.log(JSON.stringify({ selfTest: ok ? 'PASS' : 'FAIL', detected }));
  process.exit(ok ? 0 : 1);
}

const routes = [];
const presentationWrites = [];
for (const file of controllers) {
  const rel = relative(repoRoot, file);
  const content = readFileSync(file, 'utf8');
  const pkg = packageNameFor(file);
  // apps/desk-api/src/app.ts pertence ao app (sempre registrado).
  const registered = rel.startsWith('apps/') || (pkg ? registeredPackages.has(pkg) : false);
    routes.push(...extractRoutes(content, rel, pkg, registered));
  if (!registered) continue;
  const writeMatches = [...content.matchAll(WRITE_RE)].map((m) => m[0]);
  if (writeMatches.length > 0) {
    presentationWrites.push({ file: rel, calls: writeMatches.length, sample: writeMatches.slice(0, 3) });
  }
}

const registeredRoutes = routes.filter((route) => route.registered);
const unregisteredRoutes = routes.filter((route) => !route.registered);
const mutationRoutes = registeredRoutes.filter((route) => route.methodExpectsValidation);
const mutationWithoutSchema = mutationRoutes.filter((route) => !route.hasSchema);
const mutationsWithoutBodySchema = mutationRoutes.filter((route) => !route.hasBodySchema);
const summary = {
  scannedAt: new Date().toISOString(),
  controllerFiles: controllers.length,
  routeCount: registeredRoutes.length,
  unregisteredRouteCount: unregisteredRoutes.length,
  unregisteredPackages: [...new Set(unregisteredRoutes.map((route) => route.package))].filter(Boolean),
  mutationRouteCount: mutationRoutes.length,
  mutationWithoutSchema: mutationWithoutSchema.length,
  mutationsWithoutBodySchema: mutationsWithoutBodySchema.length,
  routesWithSchema: registeredRoutes.filter((route) => route.hasSchema).length,
  presentationFilesWithRepositoryWrites: presentationWrites.length,
  countsByMethod: registeredRoutes.reduce((acc, route) => ({ ...acc, [route.method]: (acc[route.method] ?? 0) + 1 }), {}),
};
const report = { summary, mutationWithoutSchema, mutationsWithoutBodySchema, presentationWrites, unregisteredRoutes, routes };
if (outPath) {
  mkdirSync(join(outPath, '..'), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(summary, null, 2));
console.log('mutationsWithoutSchema:', mutationWithoutSchema.slice(0, 20).map((route) => `${route.method} ${route.path} (${route.file})`));
console.log('presentationWrites:', presentationWrites.slice(0, 20));
