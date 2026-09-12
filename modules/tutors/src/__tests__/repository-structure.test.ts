import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../infrastructure/repositories/tutor.repository.ts'), 'utf8');

describe('TutorRepository structure', () => {
  it('uses the canonical tutor and contact relationships', () => {
    expect(repository).toContain('schema.contacts.tutorId');
    expect(repository).toContain('schema.patients.tutorId');
    expect(repository).toContain('schema.tasks.tutorId');
  });
});
