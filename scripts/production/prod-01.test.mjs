// PROD-01 — regressão documental de contratos, decisões e cobertura.
// Verifica o registro sem transformar recomendação em aprovação de produto.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const R3 = join(ROOT, 'docs', 'melhorias-2026-09-13-r3');
const contracts = readFileSync(join(R3, 'CONTRATOS.md'), 'utf8');
const decisions = readFileSync(join(R3, 'DECISOES.md'), 'utf8');
const criteria = readFileSync(join(R3, 'CRITERIOS.md'), 'utf8');
const backlog = JSON.parse(readFileSync(join(R3, 'BACKLOG.json'), 'utf8'));

const CONTRACTS = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10'];
const DECISIONS = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06'];
const REAL_PATHS = [
  'packages/auth/src/session-policy.ts',
  'packages/auth/src/authorize.ts',
  'modules/chat/src/presentation/http/webhook-inbound.controller.ts',
  'packages/events/src/outbox-publisher.ts',
  'modules/chat/src/infrastructure/repositories/outbound-delivery.repository.ts',
  'packages/media/src/scanner.ts',
  'modules/kanban/src/presentation/http/kanban.controller.ts',
  'modules/secretary-adapter/src/application/ai-policy.ts',
  'apps/realtime-service/src/index.ts',
  'scripts/production/evidence-gate.mjs',
  'apps/desk-web/src/lib/api.ts',
];

test('PROD-01-AC1 — C01-C10 têm registro operacional completo', () => {
  assert.match(contracts, /\| ID \| Produtor real \| Consumidor real \| Payload positivo \| Payload negativo e erro \| Versão\/compatibilidade \| Evidência requerida \|/);
  const rows = contracts.split('\n').filter((line) => /^\| C\d+ /.test(line));
  assert.equal(rows.length, CONTRACTS.length);
  for (const id of CONTRACTS) {
    const row = rows.find((line) => line.startsWith(`| ${id} `));
    assert.ok(row, `${id} ausente`);
    assert.equal(row.split('|').length, 9, `${id} sem todas as colunas`);
    assert.match(row, /`[^`]+\/[^`]+`/, `${id} sem caminho real`);
    assert.match(row, /v1/, `${id} sem versão`);
    assert.match(row, /PROD-?\d+/, `${id} sem evidência/tarefa`);
  }
  for (const path of REAL_PATHS) assert.equal(existsSync(join(ROOT, path)), true, `caminho ausente: ${path}`);
});

test('PROD-01-AC2 — D01-D06 têm dono funcional, alcance e bloqueio explícito', () => {
  assert.match(decisions, /D01–D06 permanecem `OPEN`/);
  assert.match(decisions, /nomeação nominal.*pendente/);
  for (const id of DECISIONS) {
    assert.match(decisions, new RegExp(`^\\| ${id} \\|`, 'm'), `${id} sem registro`);
    assert.match(decisions, new RegExp(`${id}[^\\n]*\\|[^\\n]*\\|[^\\n]*PROD-`, 'm'), `${id} sem dono/alcance`);
  }
  assert.match(decisions, /nenhuma foi apresentada como aprovada ou ratificada/);
  assert.match(decisions, /somente a ação dependente indicada/);
});

test('PROD-01-AC3 — cobertura permanece completa e os critérios não ficam implícitos', () => {
  assert.equal(backlog.tasks.length, 45);
  const auditItems = new Set(backlog.tasks.flatMap((task) => task.audit_items));
  assert.equal(auditItems.size, 55);
  for (const id of ['PROD-01-AC1', 'PROD-01-AC2', 'PROD-01-AC3', 'PROD-01-AC4']) {
    assert.match(JSON.stringify(backlog.tasks.find((task) => task.id === 'PROD-01')), new RegExp(id));
  }
  assert.match(criteria, /Cada prova registra candidato\/commit/);
  assert.match(criteria, /FAIL\/BLOCKED\/STALE\/NOT_RUN/);
});

test('PROD-01-AC4 — documentação distingue proposta, aprovação e implantação', () => {
  assert.match(decisions, /implementação futura depende de solicitação própria/);
  assert.match(decisions, /não substitui autorização vinculada ao pacote de implantação/);
  assert.match(contracts, /Aceite oficial de provider.*continuam bloqueados/);
  assert.match(contracts, /não transforma recomendação em ratificação/);
});
