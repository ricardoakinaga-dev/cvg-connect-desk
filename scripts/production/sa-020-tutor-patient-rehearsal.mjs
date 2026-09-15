// SA-020/AC2 — ensaio de rollback/rollforward do vínculo N:N tutor–paciente.
//
// Roda SOMENTE no PostgreSQL isolado do run (SA-003) e prova, sem tocar dados
// reais:
//   1. forward + backfill a partir da coluna legada 1:N;
//   2. unicidade (PK composta) e no máximo um primário por paciente;
//   3. N:N real (dois tutores no mesmo paciente) funciona;
//   4. rollback remove apenas a estrutura nova; `patients.tutor_id` intacto;
//   5. rollforward é idempotente (sem duplicar vínculos legados).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL é obrigatório (runner isolado)');
const outPath = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const sql = (name) => readFileSync(join('docs', 'programa-triplo-aaa-2026-09-14', 'decisoes', 'd03', name), 'utf8');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`[sa020] ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
};

const tutorA = randomUUID();
const tutorB = randomUUID();
const patientA = randomUUID();
const patientB = randomUUID();
const patientC = randomUUID();

async function cleanup() {
  await client.query('DROP TABLE IF EXISTS patient_tutor_links');
  await client.query('DELETE FROM patients WHERE id = ANY($1)', [[patientA, patientB, patientC]]);
  await client.query('DELETE FROM tutors WHERE id = ANY($1)', [[tutorA, tutorB]]);
}

try {
  // Sem transação externa: os casos de erro esperado (duplicata/segundo
  // primário) não devem abortar um bloco maior. O cleanup remove tudo.
  // 0) Fixture sintética: dois tutores, dois pacientes com tutor legado e um sem.
  await client.query('INSERT INTO tutors (id, name) VALUES ($1, $2), ($3, $4)', [tutorA, 'D03 Tutor A', tutorB, 'D03 Tutor B']);
  await client.query(
    'INSERT INTO patients (id, name, tutor_id) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, NULL)',
    [patientA, 'D03 Paciente A', tutorA, patientB, 'D03 Paciente B', tutorB, patientC, 'D03 Paciente C'],
  );

  // 1) Forward + backfill.
  await client.query(sql('001_patient_tutor_links.sql'));
  const links = await client.query(
    'SELECT patient_id, tutor_id, is_primary FROM patient_tutor_links ORDER BY patient_id',
  );
  record('backfill_cria_vinculos_do_legado', links.rowCount === 2, { rowCount: links.rowCount });
  record('primario_marcado', links.rows.every((row) => row.is_primary === true));

  // 2) Idempotência do forward (re-aplicar não duplica).
  await client.query(sql('001_patient_tutor_links.sql'));
  const afterSecond = await client.query('SELECT count(*)::int AS total FROM patient_tutor_links');
  record('forward_idempotente', Number(afterSecond.rows[0].total) === 2, afterSecond.rows[0]);

  // 3) Unicidade da PK composta.
  let duplicateRejected = false;
  try {
    await client.query(
      'INSERT INTO patient_tutor_links (patient_id, tutor_id) VALUES ($1, $2)',
      [patientA, tutorA],
    );
  } catch {
    duplicateRejected = true;
  }
  record('pk_composta_rejeita_duplicata', duplicateRejected);

  // 4) No máximo um primário por paciente.
  let secondPrimaryRejected = false;
  try {
    await client.query(
      'INSERT INTO patient_tutor_links (patient_id, tutor_id, is_primary) VALUES ($1, $2, true)',
      [patientA, tutorB],
    );
  } catch {
    secondPrimaryRejected = true;
  }
  record('um_primario_por_paciente', secondPrimaryRejected);

  // 5) N:N real: paciente A com dois tutores (segundo não-primário).
  await client.query(
    'INSERT INTO patient_tutor_links (patient_id, tutor_id, is_primary) VALUES ($1, $2, false)',
    [patientA, tutorB],
  );
  const manyToMany = await client.query(
    'SELECT count(*)::int AS total FROM patient_tutor_links WHERE patient_id = $1',
    [patientA],
  );
  record('n_n_dois_tutores_no_paciente', Number(manyToMany.rows[0].total) === 2, manyToMany.rows[0]);

  // 5b) Primário divergente: operador escolheu outro primário ANTES do backfill
  // (escrita parcial/cutover). O backfill NÃO pode violar o índice parcial.
  const patientD = randomUUID();
  await client.query(
    "INSERT INTO patients (id, name, tutor_id) VALUES ($1, 'D03 Paciente D', $2)",
    [patientD, tutorA],
  );
  await client.query(
    'INSERT INTO patient_tutor_links (patient_id, tutor_id, is_primary) VALUES ($1, $2, true)',
    [patientD, tutorB],
  );
  let divergentBackfillOk = true;
  let divergentError = null;
  try {
    await client.query(sql('001_patient_tutor_links.sql'));
  } catch (error) {
    divergentBackfillOk = false;
    divergentError = String(error).slice(0, 200);
  }
  const divergentRows = await client.query(
    'SELECT tutor_id, is_primary FROM patient_tutor_links WHERE patient_id = $1 ORDER BY is_primary DESC',
    [patientD],
  );
  record('backfill_respeita_primario_divergente',
    divergentBackfillOk && divergentRows.rowCount === 1 && divergentRows.rows[0].tutor_id === tutorB,
    { divergentBackfillOk, divergentError, rows: divergentRows.rows });
  await client.query('DELETE FROM patients WHERE id = $1', [patientD]);

  // 5c) Vínculo legado existente como NÃO-primário não é promovido (idempotência
  // sem sobrescrever escolha do operador).
  await client.query('UPDATE patient_tutor_links SET is_primary = false WHERE patient_id = $1', [patientA]);
  await client.query(
    'UPDATE patient_tutor_links SET is_primary = true WHERE patient_id = $1 AND tutor_id = $2',
    [patientA, tutorB],
  );
  await client.query(sql('001_patient_tutor_links.sql'));
  const nonPrimaryLegacy = await client.query(
    'SELECT is_primary FROM patient_tutor_links WHERE patient_id = $1 AND tutor_id = $2',
    [patientA, tutorA],
  );
  record('backfill_nao_promove_vinculo_nao_primario',
    nonPrimaryLegacy.rows[0]?.is_primary === false,
    nonPrimaryLegacy.rows[0]);

  // 6) Rollback remove só a estrutura nova. O vínculo N:N que SÓ existia na
  // tabela nova é perdido por desenho (documentado em D03): registramos a
  // perda explicitamente em vez de mascará-la.
  const nOnlyBefore = await client.query(
    'SELECT count(*)::int AS total FROM patient_tutor_links WHERE patient_id = $1 AND tutor_id = $2',
    [patientA, tutorB],
  );
  await client.query(sql('001_rollback.sql'));
  const nOnlyAfter = await client.query(
    "SELECT to_regclass('public.patient_tutor_links') AS reg",
  );
  record('rollback_perde_vinculo_n_n_por_desenho',
    Number(nOnlyBefore.rows[0].total) === 1 && nOnlyAfter.rows[0].reg === null,
    { antes: nOnlyBefore.rows[0].total, tabelaDepois: nOnlyAfter.rows[0].reg });
  const legacy = await client.query(
    'SELECT id, tutor_id FROM patients WHERE id = ANY($1) ORDER BY id',
    [[patientA, patientB, patientC]],
  );
  const legacyById = new Map(legacy.rows.map((row) => [row.id, row.tutor_id]));
  record('rollback_preserva_pacientes_e_tutor_legado',
    legacy.rowCount === 3 && legacyById.get(patientA) === tutorA && legacyById.get(patientB) === tutorB && legacyById.get(patientC) === null,
    Object.fromEntries(legacyById));
  const tableGone = await client.query("SELECT to_regclass('public.patient_tutor_links') AS reg");
  record('rollback_remove_tabela_nova', tableGone.rows[0].reg === null, tableGone.rows[0]);

  // 7) Rollforward volta a criar os vínculos legados sem perda de pacientes.
  await client.query(sql('001_patient_tutor_links.sql'));
  const restored = await client.query('SELECT count(*)::int AS total FROM patient_tutor_links');
  const patientsStill = await client.query('SELECT count(*)::int AS total FROM patients WHERE id = ANY($1)', [[patientA, patientB, patientC]]);
  record('rollforward_reconstroi_legado_sem_perda',
    Number(restored.rows[0].total) === 2 && Number(patientsStill.rows[0].total) === 3,
    { links: restored.rows[0].total, patients: patientsStill.rows[0].total });
} catch (error) {
  record('execucao_do_ensaio', false, { error: String(error) });
} finally {
  await cleanup().catch(() => undefined);
  await client.end();
}

const report = {
  checkedAt: new Date().toISOString(),
  databaseUrlHash: (await import('node:crypto')).createHash('sha256').update(databaseUrl).digest('hex'),
  result: checks.every((check) => check.ok) ? 'PASS' : 'FAIL',
  checks,
};
if (outPath) {
  mkdirSync(join(outPath, '..'), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ result: report.result, checks: checks.length, failed: checks.filter((check) => !check.ok).length }));
process.exit(report.result === 'PASS' ? 0 : 1);
