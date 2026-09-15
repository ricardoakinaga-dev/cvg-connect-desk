import { CONSUMER_IDS } from '@cvg/events';

/**
 * Contrato explícito de eventos do worker (PROD-09/BK06).
 *
 * O worker só faz claim de tipos listados aqui — evento fora do contrato não é
 * reservado nem ACKado (não some nem vira DLQ em massa). Versão acima da
 * suportada vira falha permanente com DLQ (`UNSUPPORTED_EVENT_VERSION`).
 */
export interface WorkerEventContractEntry {
  maxVersion: number;
}

export const WORKER_CONSUMER_ID = CONSUMER_IDS.WORKER;

export const WORKER_EVENT_CONTRACT: Readonly<Record<string, WorkerEventContractEntry>> = Object.freeze({
  'handoff.completed': { maxVersion: 1 },
  'secretary.invocation': { maxVersion: 1 },
  'message.persisted': { maxVersion: 1 },
});

export const WORKER_EVENT_TYPES: readonly string[] = Object.freeze(Object.keys(WORKER_EVENT_CONTRACT));

export type WorkerLogFields = Record<string, unknown> & { msg?: string; level?: string };

export interface WorkerLogger {
  info(fields: WorkerLogFields): void;
  warn(fields: WorkerLogFields): void;
  error(fields: WorkerLogFields): void;
}

export const consoleWorkerLogger: WorkerLogger = {
  info: (fields) => console.info(JSON.stringify({ ...fields, level: 'info' })),
  warn: (fields) => console.warn(JSON.stringify({ ...fields, level: 'warn' })),
  error: (fields) => console.error(JSON.stringify({ ...fields, level: 'error' })),
};
