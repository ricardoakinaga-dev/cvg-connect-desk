// Inventario de disponibilidade de dependencias externas do programa.
// Servico ausente => BLOCKED com dono na tarefa dependente; nunca vira skip/PASS.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso, productionEvidenceDir, REPO_ROOT, run, writeJson } from './program.mjs';

function tcpOpen(port, host = '127.0.0.1', timeoutMs = 700) {
  return new Promise((resolveDone) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    import('node:net').then(({ createConnection }) => {
      const socket = createConnection({ host, port });
      const finish = (value) => {
        socket.removeAllListeners();
        socket.destroy();
        resolveDone(value);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  });
}

const PG_BIN_CANDIDATES = [
  process.env.AAA_PG_BIN,
  process.env.CVG_LOCAL_PG_BIN,
  join(process.env.HOME || '', '.local', 'share', 'cvg-his-v4-runtime', 'root', 'usr', 'lib', 'postgresql', '16', 'bin'),
  '/usr/lib/postgresql/16/bin',
].filter(Boolean);

const REDIS_BIN_CANDIDATES = [
  process.env.AAA_REDIS_BIN,
  join(process.env.HOME || '', '.local', 'share', 'cvg-his-v4-runtime', 'root', 'usr', 'bin', 'redis-server'),
  '/usr/bin/redis-server',
  '/usr/local/bin/redis-server',
].filter(Boolean);

export function pgBinariesAvailable() {
  const found = PG_BIN_CANDIDATES.find(
    (dir) => existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'postgres')) && existsSync(join(dir, 'pg_ctl')),
  );
  return { available: Boolean(found), binDir: found ?? null, candidates: PG_BIN_CANDIDATES };
}

export function redisBinaryAvailable() {
  const runtimeRoot = join(process.env.HOME || '', '.local', 'share', 'cvg-his-v4-runtime', 'root');
  const runtimeEnv = {
    ...process.env,
    LD_LIBRARY_PATH: [
      join(runtimeRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
      join(runtimeRoot, 'usr', 'lib'),
      join(runtimeRoot, 'lib', 'x86_64-linux-gnu'),
      process.env.LD_LIBRARY_PATH,
    ].filter(Boolean).join(':'),
  };
  for (const candidate of REDIS_BIN_CANDIDATES) {
    if (candidate.includes('/') && existsSync(candidate)) {
      const isRuntime = candidate.includes('/cvg-his-v4-runtime/');
      const probe = run(candidate, ['--version'], { env: isRuntime ? runtimeEnv : {} });
      if (probe.ok) {
        return { available: true, bin: candidate, version: probe.stdout || null };
      }
    }
    if (!candidate.includes('/')) {
      const probe = run(candidate, ['--version']);
      if (probe.ok) {
        return { available: true, bin: candidate, version: probe.stdout || null };
      }
    }
  }
  return { available: false, bin: null, version: null };
}

export function playwrightBrowsers() {
  const cache = join(process.env.HOME || '', '.cache', 'ms-playwright');
  const entries = existsSync(cache)
    ? run('ls', [cache]).stdout.split('\n').filter((line) => line.startsWith('chromium-'))
    : [];
  return { available: entries.length > 0, cache, chromium: entries.sort().at(-1) ?? null };
}

export async function collectAvailability() {
  const pg = pgBinariesAvailable();
  const redis = redisBinaryAvailable();
  const browser = playwrightBrowsers();
  const otel = existsSync('/tmp/opencode/otelcol/otelcol-contrib');
  const k6 = run('k6', ['version']);
  const osv = existsSync('/tmp/opencode/osv-scanner');
  const clam = run('clamscan', ['--version']);
  const minioBin = run('minio', ['--version']);
  const mcBin = run('mc', ['--version']);

  const services = {
    postgresql: {
      status: pg.available ? 'AVAILABLE' : 'BLOCKED',
      mode: 'binario local (initdb/postgres por run, banco marcado cvg_aaa_*)',
      detail: pg.binDir,
      hostListeners: { '127.0.0.1:5432': await tcpOpen(5432), '127.0.0.1:5543': await tcpOpen(5543) },
      owner: 'plataforma',
    },
    redis: {
      status: redis.available ? 'AVAILABLE' : 'BLOCKED',
      mode: 'binario local (instancia por run, porta dedicada)',
      detail: redis.version,
      hostListener6379: await tcpOpen(6379),
      owner: 'plataforma',
    },
    minio: {
      status: minioBin.ok || mcBin.ok ? 'BINARY_ONLY' : 'BLOCKED',
      mode: 'binario estatico local + bucket por run',
      detail: minioBin.ok ? minioBin.stdout : 'binario minio ausente; Docker sem permissao no socket',
      blocker: minioBin.ok ? null : 'sem binario local; Docker bloqueado (permission denied no socket)',
      unblocks: ['PROD-14', 'PROD-15', 'PROD-32', 'PROD-38'],
      owner: 'plataforma',
    },
    clamav: {
      status: clam.ok ? 'AVAILABLE' : 'BLOCKED',
      mode: 'clamd/clamscan local com assinatura sintetica (EICAR)',
      detail: clam.stdout || 'clamscan ausente',
      blocker: clam.ok ? null : 'sem clamscan/clamd local; Docker bloqueado',
      unblocks: ['PROD-14', 'PROD-32', 'PROD-38'],
      owner: 'plataforma',
    },
    otelCollector: {
      status: otel ? 'AVAILABLE' : 'BLOCKED',
      mode: 'otelcol-contrib local com receptor OTLP por run',
      detail: otel ? '/tmp/opencode/otelcol/otelcol-contrib' : 'ausente',
      unblocks: ['PROD-32'],
      owner: 'plataforma',
    },
    browserChromium: {
      status: browser.available ? 'AVAILABLE' : 'BLOCKED',
      mode: 'Playwright chromium headless',
      detail: browser.chromium,
      owner: 'produto',
    },
    loadGenerator: {
      status: k6.ok ? 'AVAILABLE' : 'BLOCKED',
      mode: 'k6 local',
      detail: k6.stdout.split('\n')[0] || null,
      owner: 'sre',
    },
    osvScanner: {
      status: osv ? 'AVAILABLE' : 'BLOCKED',
      mode: 'osv-scanner local',
      detail: osv ? '/tmp/opencode/osv-scanner' : null,
      owner: 'seguranca',
    },
  };

  const dockerProbe = run('docker', ['ps']);
  const summary = {
    generatedAt: nowIso(),
    programDir: REPO_ROOT,
    docker: dockerProbe.ok
      ? 'AVAILABLE'
      : `BLOCKED (${(dockerProbe.stderr || 'docker indisponivel').split('\n')[0]})`,
    dockerStderr: dockerProbe.stderr || null,
    services,
    policy:
      'Servico ausente bloqueia apenas a prova dependente (NOT_RUN/BLOCKED com dono). Inventario e harness concluem sem todos os servicos.',
  };

  const dir = productionEvidenceDir('environment');
  writeJson(join(dir, 'availability.json'), summary);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  collectAvailability().then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
  });
}
