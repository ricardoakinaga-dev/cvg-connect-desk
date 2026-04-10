import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../schema.ts');
const schemaContent = readFileSync(schemaPath, 'utf-8');

describe('Database Schema', () => {
  describe('tables', () => {
    it('exports contacts table', () => {
      expect(schemaContent).toContain('export const contacts');
    });

    it('exports tutors table', () => {
      expect(schemaContent).toContain('export const tutors');
    });

    it('exports patients table', () => {
      expect(schemaContent).toContain('export const patients');
    });

    it('exports conversations table', () => {
      expect(schemaContent).toContain('export const conversations');
    });

    it('exports messages table', () => {
      expect(schemaContent).toContain('export const messages');
    });

    it('exports users table', () => {
      expect(schemaContent).toContain('export const users');
    });

    it('exports sessions table', () => {
      expect(schemaContent).toContain('export const sessions');
    });

    it('exports roles table', () => {
      expect(schemaContent).toContain('export const roles');
    });

    it('exports permissions table', () => {
      expect(schemaContent).toContain('export const permissions');
    });

    it('exports tasks table', () => {
      expect(schemaContent).toContain('export const tasks');
    });

    it('exports internal_notes table', () => {
      expect(schemaContent).toContain('export const internalNotes');
    });

    it('exports alerts table', () => {
      expect(schemaContent).toContain('export const alerts');
    });

    it('exports labels table', () => {
      expect(schemaContent).toContain('export const labels');
    });

    it('exports sectors table', () => {
      expect(schemaContent).toContain('export const sectors');
    });

    it('exports contact_groups table', () => {
      expect(schemaContent).toContain('export const contactGroups');
    });

    it('exports audit_logs table', () => {
      expect(schemaContent).toContain('export const auditLogs');
    });

    it('exports sessions table', () => {
      expect(schemaContent).toContain('export const sessions');
    });
  });

  describe('enums', () => {
    it('exports conversation status enum', () => {
      expect(schemaContent).toContain('conversationStatusEnum');
    });

    it('exports conversation status v2 enum', () => {
      expect(schemaContent).toContain('conversationStatusV2Enum');
    });

    it('exports message direction enum', () => {
      expect(schemaContent).toContain('messageDirectionEnum');
    });

    it('exports contact group type enum', () => {
      expect(schemaContent).toContain('contactGroupTypeEnum');
    });

    it('exports transfer status enum', () => {
      expect(schemaContent).toContain('transferStatusEnum');
    });
  });

  describe('schema structure', () => {
    it('uses uuid as primary key type', () => {
      expect(schemaContent).toContain("uuid('id')");
    });

    it('uses timestamp for date columns', () => {
      expect(schemaContent).toContain("timestamp('created_at')");
    });

    it('uses text for string columns', () => {
      expect(schemaContent).toContain("text('");
    });

    it('uses pgTable as table builder', () => {
      expect(schemaContent).toContain('pgTable(');
    });

    it('uses primaryKey for id columns', () => {
      expect(schemaContent).toContain('.primaryKey()');
    });
  });
});