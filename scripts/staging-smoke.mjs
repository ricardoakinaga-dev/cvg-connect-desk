#!/usr/bin/env node
/**
 * Staging smoke (§6–8): valida integrações REAIS contra docker-compose.staging.yml.
 * 1. MinIO: put/exists/get/delete/signed no bucket.
 * 2. ClamAV: CLEAN em arquivo inócuo + EICAR → INFECTED.
 * 3. Collector: envia um span e furas preventivamente
 *    (roda desk-api? > já validado por unit; aqui valida rede do collector).
 *
 * Uso: pnpm staging:smoke (env S3 e CLAMAV e OTEL herdados do compose)
 */
const { S3Client, CreateBucketCommand, DeleteObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
const net = await import('node:net');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
}

// --- MinIO real ---
try {
  const endpoint = process.env.S3_ENDPOINT || 'http://127.0.0.1:9100';
  const bucket = process.env.S3_BUCKET || 'cvg-media-test';
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin' },
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket })).catch((e) => {
    if (e.name !== 'BucketAlreadyOwnedByYou' && e.name !== 'BucketAlreadyExists') throw e;
  });
  const { S3MediaStorage } = await import('../packages/media/src/s3-storage.ts');
  const storage = new S3MediaStorage({ endpoint, region: 'us-east-1', bucket, accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin', forcePathStyle: true, client });
  const stamp = `staging-smoke-${Date.now()}`;
  await storage.put({ key: `smoke/${stamp}`, body: Buffer.from('staging-smoke'), contentType: 'text/plain' });
  check('minio.put', await storage.exists(`smoke/${stamp}`));
  const got = await storage.get(`smoke/${stamp}`);
  check('minio.get+exists', got.toString() === 'staging-smoke');
  const signed = await storage.createSignedReadUrl(`smoke/${stamp}`, 60);
  check('minio.signed-url', signed.includes('X-Amz-Signature'));
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `smoke/${stamp}` }));
  let deleted = false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: `smoke/${stamp}` }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const name = error?.name;
    if (status !== 404 && name !== 'NotFound' && name !== 'NoSuchKey') throw error;
    deleted = true;
  }
  check('minio.delete', deleted);
} catch (error) {
  check('minio', false, error.message);
}

// --- ClamAV real ---
try {
  const port = Number(process.env.CLAMAV_PORT || 9310);
  const host = process.env.CLAMAV_HOST || '127.0.0.1';
  const { ClamAVScanner } = await import('../packages/media/src/scanner.ts');
  const scanner = new ClamAVScanner(host, port);
  const clean = await scanner.scan(Buffer.from('staging smoke clean file'));
  check('clamav.clean', clean.status === 'CLEAN', clean.status);
  const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  const infected = await scanner.scan(eicar, 'eicar.txt');
  check('clamav.eicar->infected', infected.status === 'INFECTED', `${infected.status} ${infected.signature || ''}`);
} catch (error) {
  check('clamav', false, error.message);
}

// --- Collector reachable (ports) ---
try {
  const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318/v1/traces');
  const ok = await new Promise((resolve) => {
    const s = net.connect(Number(endpoint.port), endpoint.hostname, () => {
      s.end();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    setTimeout(() => resolve(false), 3000);
  });
  check('otel.collector reachable', ok, endpoint.port);
} catch (error) {
  check('otel.collector', false, error.message);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`STAGING SMOKE: ${failed.length} falhas`);
  process.exit(1);
}
console.log('STAGING SMOKE: OK');
