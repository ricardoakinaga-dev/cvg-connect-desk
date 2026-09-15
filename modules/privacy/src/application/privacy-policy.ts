/**
 * AAA-17 / C07 — matriz de política por tipo/cópia e configuração.
 *
 * A decisão D02 (responsável pelos dados) NÃO está aprovada. O código não
 * inventa aprovação: sem configuração explícita ele opera em `dry-run` e
 * nenhuma eliminação irreversível é habilitada. A matriz abaixo é a proposta
 * técnica anexada à D02 (ver docs/LGPD_DATA_SUBJECT_REQUESTS.md) e pode ser
 * ratificada apenas pela configuração de ambiente.
 */

export const PRIVACY_COPY_TYPES = [
  'contact',
  'tutor-link',
  'conversation',
  'message',
  'note',
  'outbox',
  'dlq',
  'media-asset',
  'audit',
  'backup',
] as const;

export type PrivacyCopyType = (typeof PRIVACY_COPY_TYPES)[number];

export interface PrivacyCopyPolicy {
  copy: PrivacyCopyType;
  purpose: string;
  retention: string;
  exportable: boolean;
  pseudonymizable: boolean;
  deletable: boolean;
  backup: boolean;
  pendingDecision: 'D02' | null;
  notes: string;
}

/**
 * Matriz por tipo/cópia: finalidade / retenção / exportar / pseudonimizar /
 * apagar / backup. `deletable` descreve a capacidade técnica condicionada à
 * aprovação D02 — nunca uma execução por padrão.
 */
export const POLICY_MATRIX: readonly PrivacyCopyPolicy[] = [
  {
    copy: 'contact',
    purpose: 'Identificação e contato do titular',
    retention: 'Enquanto o vínculo operacional existir; prazo final pendente D02',
    exportable: true,
    pseudonymizable: true,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'PII direta: phone/name/email/externalId/metadata',
  },
  {
    copy: 'tutor-link',
    purpose: 'Vínculo do contato com tutor/paciente',
    retention: 'Enquanto o vínculo existir; registro pertence a outro titular',
    exportable: true,
    pseudonymizable: false,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Tutor/paciente são titulares distintos: exigem pedido próprio; o app não reescreve esses registros',
  },
  {
    copy: 'conversation',
    purpose: 'Histórico de atendimento',
    retention: 'Obrigação operacional; prazo total pendente D02',
    exportable: true,
    pseudonymizable: true,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Pseudonimiza metadata; identificadores externos de roteamento são mantidos',
  },
  {
    copy: 'message',
    purpose: 'Histórico de mensagens do atendimento',
    retention: 'Obrigação operacional; conteúdo é pseudonimizado por token; retenção total pendente D02',
    exportable: true,
    pseudonymizable: true,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Substitui ocorrências dos identificadores diretos em content/sender/recipient/metadata',
  },
  {
    copy: 'note',
    purpose: 'Anotações internas da equipe',
    retention: 'Operacional; conteúdo pseudonimizado por token',
    exportable: true,
    pseudonymizable: true,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Preserva autoria profissional; redige identificadores do titular',
  },
  {
    copy: 'outbox',
    purpose: 'Entrega de eventos interprocesso',
    retention: 'Até processamento/reconciliação; TTL operacional',
    exportable: true,
    pseudonymizable: true,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Payload/metadata são textos de pipeline; redação por token',
  },
  {
    copy: 'dlq',
    purpose: 'Falha terminal para replay/reconciliação',
    retention: 'Enquanto pendente de resolução',
    exportable: true,
    pseudonymizable: true,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Payload JSON e errorMessage redigidos por token',
  },
  {
    copy: 'media-asset',
    purpose: 'Anexos e documentos do atendimento',
    retention: 'media_assets.retentionUntil quando definido; bytes externos no storage',
    exportable: true,
    pseudonymizable: true,
    deletable: true,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Bytes exigem exclusão irreversível explícita (PRIVACY_ALLOW_IRREVERSIBLE_DELETE)',
  },
  {
    copy: 'audit',
    purpose: 'Rastreabilidade de ações do sistema',
    retention: 'Logs operacionais: 90 dias (base documentada)',
    exportable: true,
    pseudonymizable: true,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Redige old/new/metadata preservando ação, ator, correlação e timestamps',
  },
  {
    copy: 'backup',
    purpose: 'Recuperação de desastre',
    retention: '14 dias (pg-backup.sh); retenção efetiva do provedor do volume',
    exportable: false,
    pseudonymizable: false,
    deletable: false,
    backup: true,
    pendingDecision: 'D02',
    notes: 'Não é reescrito pelo app; residual declarado e reaplicação da política após restore',
  },
];

export function policyFor(copy: PrivacyCopyType): PrivacyCopyPolicy {
  const found = POLICY_MATRIX.find((entry) => entry.copy === copy);
  if (!found) throw new Error(`[privacy] cópia sem política: ${copy}`);
  return found;
}

export type PrivacyOperationMode = 'dry-run' | 'execute';

export interface PrivacyPolicy {
  version: string;
  mode: PrivacyOperationMode;
  irreversibleDeleteAllowed: boolean;
  approvedPseudonymizeTypes: PrivacyCopyType[];
  approvedDeleteTypes: PrivacyCopyType[];
}

export const DEFAULT_POLICY_VERSION = 'd02-pending-v1';

function parseCopyList(raw: string | undefined): PrivacyCopyType[] {
  if (!raw) return [];
  const known = new Set<string>(PRIVACY_COPY_TYPES);
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => known.has(value)) as PrivacyCopyType[];
}

function parseBoolean(raw: string | undefined): boolean {
  return raw === '1' || raw?.toLowerCase() === 'true';
}

/**
 * Configuração segura por padrão:
 *   - `PRIVACY_OPERATION_MODE` ausente ⇒ `dry-run` (nenhuma mutação);
 *   - `PRIVACY_APPROVED_PSEUDONYMIZE_TYPES` ausente ⇒ nenhuma cópia aprovada;
 *   - `PRIVACY_ALLOW_IRREVERSIBLE_DELETE` ausente ⇒ exclusão irreversível desligada.
 * Habilitar execução é decisão explícita do responsável pelos dados (D02).
 */
export function loadPrivacyPolicy(env: NodeJS.ProcessEnv = process.env): PrivacyPolicy {
  const rawMode = (env.PRIVACY_OPERATION_MODE || 'dry-run').toLowerCase();
  const mode: PrivacyOperationMode = rawMode === 'execute' ? 'execute' : 'dry-run';
  return {
    version: env.PRIVACY_POLICY_VERSION?.trim() || DEFAULT_POLICY_VERSION,
    mode,
    irreversibleDeleteAllowed: parseBoolean(env.PRIVACY_ALLOW_IRREVERSIBLE_DELETE),
    approvedPseudonymizeTypes: parseCopyList(env.PRIVACY_APPROVED_PSEUDONYMIZE_TYPES),
    approvedDeleteTypes: parseCopyList(env.PRIVACY_APPROVED_DELETE_TYPES),
  };
}

export function wouldPseudonymize(policy: PrivacyPolicy, copy: PrivacyCopyType): boolean {
  return policy.mode === 'execute'
    && policy.approvedPseudonymizeTypes.includes(copy)
    && policyFor(copy).pseudonymizable;
}

export function wouldDelete(policy: PrivacyPolicy, copy: PrivacyCopyType): boolean {
  return policy.mode === 'execute'
    && policy.irreversibleDeleteAllowed
    && policy.approvedDeleteTypes.includes(copy)
    && policyFor(copy).deletable;
}
