#!/usr/bin/env node
/**
 * Production readiness (§25): valida configuração DE PRODUÇÃO sem deploy.
 * Produção mal configurada → exit 1 (fail fast).
 */
const REQUIRED_PROD = [
  ['DATABASE_URL', (v) => v && /^postgres(ql)?:\/\//.test(v), 'deve ser postgres://'],
  ['REDIS_URL', (v) => v && /^redis:\/\//.test(v), 'deve ser redis://'],
  ['CORS_ORIGIN', (v) => v && !['*', ''].includes(v.trim()), 'não pode ser * nem vazio (fail-secure)'],
  ['WIEMHOOK_UNUSED', () => true, ''],
  ['WEBHOOK_SECRET', (v) => v && v.length >= 16, 'mínimo 16 chars'],
  ['MEDIA_STORAGE_DRIVER', (v) => v === 's3', 'produção exige s3'],
];

const FORBIDDEN_PROD = [
  ['NODE_ENV', (v) => v === 'development' || v === 'test', 'deve ser production'],
  ['MEDIA_STORAGE_DRIVER', (v) => v === 'memory' && process.env.MEDIA_ALLOW_MEMORY !== 'true', 'memory proibido (ou MEDIA_ALLOW_MEMORY=true)'],
  ['MALWARE_SCANNER', (v) => v === 'fake' && process.env.MEDIA_ALLOW_FAKE_SCANNER !== 'true', 'fake proibido'],
  ['CORS_ORIGIN', (v) => v.trim() === '*', 'wildcard proibido'],
  ['JWT_SECRET', (v) => v === 'change_me_in_production_use_strong_random_key', 'placeholder proibido'],
];

const S3_REQUIRED_WHEN_S3 = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
const CLAMAV_REQUIRED_WHEN_CLAMAV = ['CLAMAV_HOST', 'CLAMAV_PORT'];
const OTLP_REQUIRED_WHEN_OTEL = ['OTEL_EXPORTER_OTLP_ENDPOINT'];

const errors = [];
const warnings = [];
const infos = [];

for (const [name, validate, hint] of REQUIRED_PROD) {
  if (name === 'WIEMHOOK_UNUSED') continue;
  if (!validate(process.env[name] || '')) errors.push(`${name}: ${hint}`);
}
for (const [name, validate, hint] of FORBIDDEN_PROD) {
  if (validate(process.env[name] || '')) errors.push(`${name}: ${hint}`);
}

if ((process.env.MEDIA_STORAGE_DRIVER || 'memory') === 's3') {
  for (const name of S3_REQUIRED_WHEN_S3) {
    if (!process.env[name]) errors.push(`${name}: obrigatório com MEDIA_STORAGE_DRIVER=s3`);
  }
  if (process.env.S3_ENDPOINT && process.env.S3_ENDPOINT.includes('localhost')) {
    warnings.push('S3_ENDPOINT aponta localhost (revisar para produção)');
  }
} else {
  errors.push('MEDIA_STORAGE_DRIVER: produção exige s3 (cfg atual: memory ou ausente)');
}

if ((process.env.MALWARE_SCANNER || '') === 'clamav') {
  for (const name of CLAMAV_REQUIRED_WHEN_CLAMAV) {
    if (!process.env[name]) errors.push(`${name}: obrigatório com MALWARE_SCANNER=clamav`);
  }
} else {
  warnings.push('MALWARE_SCANNER não configurado: docs exigem fail-secure (documents) — ver MEDIA_REQUIRE_SCAN');
  if ((process.env.MEDIA_REQUIRE_SCAN || 'documents') === 'none') {
    errors.push('MEDIA_REQUIRE_SCAN=none em produção: documentos sem escaneamento');
  }
}

if ((process.env.OTEL_ENABLED || 'false') === 'true') {
  for (const name of OTLP_REQUIRED_WHEN_OTEL) {
    if (!process.env[name]) errors.push(`${name}: obrigatório com OTEL_ENABLED=true`);
  }
} else {
  infos.push('OTEL_ENABLED=false: sem tracing (aceitável em degradação, revisar SLOs)');
}

if (!process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.ADMIN_BOOTSTRAP_PASSWORD.length < 12) {
  warnings.push('ADMIN_BOOTSTRAP_PASSWORD ausente/curta: seed fail-secure não criará admin (ok se admin já existe)');
  if (!process.env.ADMIN_BOOTSTRAP_EMAIL) warnings.push('ADMIN_BOOTSTRAP_EMAIL ausente');
}

if (!process.env.METRICS_TOKEN) warnings.push('METRICS_TOKEN ausente: /metrics aberto (restringir por rede/VPC)');

console.log('=== PRODUCTION READINESS ===');
console.log(`mode: ${process.env.NODE_ENV || '(ausente)'}`);
for (const info of infos) console.log(`INFO  ${info}`);
for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const error of errors) console.log(`ERROR ${error}`);
console.log(`=== ${errors.length === 0 ? 'READY' : 'NOT READY (fail fast)'} ===`);

if (errors.length > 0) process.exit(1);
