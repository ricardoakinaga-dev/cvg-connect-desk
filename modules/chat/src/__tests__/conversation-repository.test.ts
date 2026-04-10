import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoPath = resolve(__dirname, '../infrastructure/repositories/conversation.repository.ts');
const content = readFileSync(repoPath, 'utf-8');

describe('ConversationRepository', () => {
  describe('structure', () => {
    it('exports conversationRepository object', () => {
      expect(content).toContain('export const conversationRepository');
    });

    it('has create method', () => {
      expect(content).toContain('async create(');
    });

    it('has findById method', () => {
      expect(content).toContain('async findById(');
    });

    it('has findByExternalId method', () => {
      expect(content).toContain('async findByExternalId(');
    });

    it('has findAll method', () => {
      expect(content).toContain('async findAll(');
    });

    it('has update method', () => {
      expect(content).toContain('async update(');
    });

    it('has updateStatusV2 method', () => {
      expect(content).toContain('async updateStatusV2(');
    });

    it('has updateSector method', () => {
      expect(content).toContain('async updateSector(');
    });

    it('has assignUser method', () => {
      expect(content).toContain('async assignUser(');
    });

    it('has close method', () => {
      expect(content).toContain('async close(');
    });

    it('has addStatusHistory method', () => {
      expect(content).toContain('async addStatusHistory(');
    });

    it('has countByStatusV2 method', () => {
      expect(content).toContain('async countByStatusV2(');
    });

    it('has countBySector method', () => {
      expect(content).toContain('async countBySector(');
    });

    it('uses db from @cvg/database', () => {
      expect(content).toContain("from '@cvg/database'");
    });

    it('uses drizzle-orm operators', () => {
      expect(content).toContain('eq(');
      expect(content).toContain('and(');
      expect(content).toContain('desc(');
    });
  });
});