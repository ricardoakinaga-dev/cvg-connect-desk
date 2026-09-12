import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../infrastructure/repositories/patient.repository.ts'), 'utf8');

describe('PatientRepository structure', () => {
  it('joins list results to tutors and counts patient-specific conversations', () => {
    expect(repository).toContain('leftJoin(schema.tutors');
    expect(repository).toContain('schema.contacts.patientId');
    expect(repository).toContain('schema.tasks.patientId');
  });
});
