#!/usr/bin/env node
/**
 * Production readiness (§25): valida configuração DE PRODUÇÃO sem deploy.
 * Produção mal configurada → exit 1 (fail fast).
 */
const errors = [];
const warnings = [];
const infos = [];

const env = process.env;
const present = (name) => (env[name] || '').trim().length > 0;
const addMissing = (name, reason) => errors.push(`${name}: ${reason}`);

if ((env.NODE_ENV || '').trim().toLowerCase() !== 'production') {
  addMissing('NODE_ENV', 'deve ser production');
}
if (!/^postgres(?:ql)?:\/\//.test((env.DATABASE_URL || '').trim())) {
  addMissing('DATABASE_URL', 'deve ser postgres://');
}
if (!/^rediss?:\/\//.test((env.REDIS_URL || '').trim())) {
  addMissing('REDIS_URL', 'deve ser redis:// ou rediss://');
}

const origins = (env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim());
if (origins.some((origin) => !origin || origin === '*')) {
  addMissing('CORS_ORIGIN', 'não pode ser * nem vazio (fail-secure)');
}
if (!present('WEBHOOK_SECRET') || env.WEBHOOK_SECRET.trim().length < 16) {
  addMissing('WEBHOOK_SECRET', 'mínimo 16 chars');
}

const internalSecret = ['REALTIME_INTERNAL_SECRET', 'INTERNAL_EVENTS_SECRET', 'EVENTS_API_KEY']
  .some(present);
if (!internalSecret) addMissing('INTERNAL_EVENTS_SECRET', 'credencial interna obrigatória');

if ((env.MEDIA_STORAGE_DRIVER || '').trim().toLowerCase() !== 's3') {
  addMissing('MEDIA_STORAGE_DRIVER', 'produção exige s3');
}
for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
  if (!present(name)) addMissing(name, 'obrigatório com MEDIA_STORAGE_DRIVER=s3');
}

if ((env.MALWARE_SCANNER || '').trim().toLowerCase() !== 'clamav') {
  addMissing('MALWARE_SCANNER', 'produção exige clamav real');
}
if (!present('CLAMAV_HOST')) addMissing('CLAMAV_HOST', 'obrigatório com MALWARE_SCANNER=clamav');
const clamavPort = Number(env.CLAMAV_PORT);
if (!Number.isInteger(clamavPort) || clamavPort < 1 || clamavPort > 65535) {
  addMissing('CLAMAV_PORT', 'porta inválida');
}

if (!present('METRICS_TOKEN') && !present('METRICS_ALLOWED_CIDRS')) {
  addMissing('METRICS_TOKEN', 'METRICS_TOKEN ou METRICS_ALLOWED_CIDRS obrigatório');
}

if ((env.JWT_SECRET || '').trim().toLowerCase() === 'change_me_in_production_use_strong_random_key') {
  addMissing('JWT_SECRET', 'placeholder proibido');
}

const otelEnabled = (env.OTEL_ENABLED || '').trim().toLowerCase() === 'true';
if (otelEnabled && !present('OTEL_EXPORTER_OTLP_ENDPOINT')) {
  addMissing('OTEL_EXPORTER_OTLP_ENDPOINT', 'obrigatório com OTEL_ENABLED=true');
}

if ((env.S3_ENDPOINT || '').includes('localhost')) {
  warnings.push('S3_ENDPOINT aponta localhost (revisar para produção)');
}

if (!otelEnabled) {
  infos.push('OTEL_ENABLED=false: sem tracing (aceitável em degradação, revisar SLOs)');
}

if (!env.ADMIN_BOOTSTRAP_PASSWORD || env.ADMIN_BOOTSTRAP_PASSWORD.length < 12) {
  warnings.push('ADMIN_BOOTSTRAP_PASSWORD ausente/curta: seed fail-secure não criará admin (ok se admin já existe)');
  if (!env.ADMIN_BOOTSTRAP_EMAIL) warnings.push('ADMIN_BOOTSTRAP_EMAIL ausente');
}

console.log('=== PRODUCTION READINESS ===');
console.log(`mode: ${env.NODE_ENV || '(ausente)'}`);
for (const info of infos) console.log(`INFO  ${info}`);
for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const error of errors) console.log(`ERROR ${error}`);
console.log(`=== ${errors.length === 0 ? 'READY' : 'NOT READY (fail fast)'} ===`);

if (errors.length > 0) process.exit(1);
