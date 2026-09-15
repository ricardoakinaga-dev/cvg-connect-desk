import { stripControlChars } from './redact';
/**
 * Registro de métricas estilo Prometheus (Phase 6 §9.1).
 * In-process, sem dependências: counters, gauges e histogramas simplificados
 * (buckets cumulativos + sum/count). Exposto em GET /metrics.
 *
 * Escopo por processo: cada runtime (api/worker/realtime) expõe o seu.
 * Agregação cross-replica é papel do Prometheus (sum by).
 *
 * Proteção de cardinalidade (C08/AAA-18):
 * - valores de label são saneados (sem controles) e truncados;
 * - cada coletor tem teto de séries distintas; o excedente agrega em
 *   `__other__`, então um bug de chamada não derruba a memória do processo.
 */

export type LabelValues = Record<string, string | number | boolean>;

/** Teto de séries distintas por coletor (backstop de cardinalidade). */
export const METRICS_MAX_SERIES_PER_COLLECTOR = 1000;
/** Comprimento máximo de um valor de label na exposição. */
export const METRICS_MAX_LABEL_VALUE_LENGTH = 120;
/** Valor usado ao agregar séries que excedem o teto do coletor. */
export const METRICS_OVERFLOW_LABEL_VALUE = '__other__';

function labelsKey(labels: LabelValues): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${JSON.stringify(labels[k])}`)
    .join(',');
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Remove controles (evita injeção de linhas) e limita o comprimento do valor. */
export function sanitizeLabelValue(value: string | number | boolean): string {
  const text = stripControlChars(String(value));
  return text.length > METRICS_MAX_LABEL_VALUE_LENGTH
    ? text.slice(0, METRICS_MAX_LABEL_VALUE_LENGTH)
    : text;
}

function sanitizeLabels(labels: LabelValues): LabelValues {
  const sanitized: LabelValues = {};
  for (const [key, value] of Object.entries(labels)) {
    sanitized[key] = sanitizeLabelValue(value);
  }
  return sanitized;
}

function overflowLabels(labels: LabelValues): LabelValues {
  const overflow: LabelValues = {};
  for (const key of Object.keys(labels)) {
    overflow[key] = METRICS_OVERFLOW_LABEL_VALUE;
  }
  return overflow;
}

/**
 * Resolve a série de `labels` ou agrega no bucket `__other__` quando o teto
 * do coletor já foi atingido.
 */
function resolveSeries<T>(
  map: Map<string, T>,
  labels: LabelValues,
  create: (labels: LabelValues) => T,
): T {
  const key = labelsKey(labels);
  const existing = map.get(key);
  if (existing) return existing;

  if (map.size >= METRICS_MAX_SERIES_PER_COLLECTOR) {
    const overflow = overflowLabels(labels);
    const overflowKey = labelsKey(overflow);
    const existingOverflow = map.get(overflowKey);
    if (existingOverflow) return existingOverflow;
    const entry = create(overflow);
    map.set(overflowKey, entry);
    return entry;
  }

  const entry = create(labels);
  map.set(key, entry);
  return entry;
}

export class Counter {
  private values = new Map<string, { labels: LabelValues; value: number }>();

  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  inc(labels: LabelValues = {}, amount = 1): void {
    const clean = sanitizeLabels(labels);
    const entry = resolveSeries(this.values, clean, (seriesLabels) => ({ labels: seriesLabels, value: 0 }));
    entry.value += amount;
  }

  get(labels: LabelValues = {}): number {
    return this.values.get(labelsKey(sanitizeLabels(labels)))?.value ?? 0;
  }

  get seriesCount(): number {
    return this.values.size;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

export class Gauge {
  private values = new Map<string, { labels: LabelValues; value: number }>();

  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  set(labels: LabelValues, value: number): void;
  set(value: number): void;
  set(a: LabelValues | number, b?: number): void {
    if (typeof a === 'number') {
      this.values.set('', { labels: {}, value: a });
      return;
    }
    const clean = sanitizeLabels(a);
    const entry = resolveSeries(this.values, clean, (seriesLabels) => ({ labels: seriesLabels, value: 0 }));
    entry.value = b ?? 0;
  }

  inc(labels: LabelValues = {}, amount = 1): void {
    const clean = sanitizeLabels(labels);
    const entry = resolveSeries(this.values, clean, (seriesLabels) => ({ labels: seriesLabels, value: 0 }));
    entry.value += amount;
  }

  dec(labels: LabelValues = {}, amount = 1): void {
    this.inc(labels, -amount);
  }

  get(labels: LabelValues = {}): number {
    return this.values.get(labelsKey(sanitizeLabels(labels)))?.value ?? 0;
  }

  get seriesCount(): number {
    return this.values.size;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class Histogram {
  private buckets: number[];
  private counts = new Map<string, { labels: LabelValues; counts: number[]; sum: number; total: number }>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    buckets: number[] = DEFAULT_BUCKETS,
  ) {
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(value: number, labels: LabelValues = {}): void {
    const clean = sanitizeLabels(labels);
    const entry = resolveSeries(this.counts, clean, (seriesLabels) => ({
      labels: seriesLabels,
      counts: this.buckets.map(() => 0),
      sum: 0,
      total: 0,
    }));
    entry.total += 1;
    entry.sum += value;
    this.buckets.forEach((bound, i) => {
      if (value <= bound) entry.counts[i] += 1;
    });
  }

  get seriesCount(): number {
    return this.counts.size;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, total } of this.counts.values()) {
      this.buckets.forEach((bound, i) => {
        lines.push(`${this.name}_bucket${renderLabels({ ...labels, le: String(bound) })} ${counts[i]}`);
      });
      lines.push(`${this.name}_bucket${renderLabels({ ...labels, le: '+Inf' })} ${total}`);
      lines.push(`${this.name}_sum${renderLabels(labels)} ${sum}`);
      lines.push(`${this.name}_count${renderLabels(labels)} ${total}`);
    }
    return lines.join('\n');
  }
}

function renderLabels(labels: LabelValues): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabelValue(String(labels[k]))}"`).join(',')}}`;
}

export class MetricsRegistry {
  private collectors: Array<Counter | Gauge | Histogram> = [];

  counter(name: string, help: string): Counter {
    const c = new Counter(name, help);
    this.collectors.push(c);
    return c;
  }

  gauge(name: string, help: string): Gauge {
    const g = new Gauge(name, help);
    this.collectors.push(g);
    return g;
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    const h = new Histogram(name, help, buckets);
    this.collectors.push(h);
    return h;
  }

  render(): string {
    return `${this.collectors.map((c) => c.render()).join('\n')}\n`;
  }
}

/** Registro global do processo (api). Worker/realtime mantêm os seus. */
export const metrics = new MetricsRegistry();

export const httpRequestsTotal = metrics.counter('http_requests_total', 'Total de requests HTTP por rota e status');
export const httpRequestDuration = metrics.histogram(
  'http_request_duration_seconds',
  'Duracao de requests HTTP em segundos',
);
export const webhookRequestsTotal = metrics.counter('webhook_requests_total', 'Requests de webhook por decisao');
export const webhookReplayRejectedTotal = metrics.counter(
  'webhook_replay_rejected_total',
  'Webhooks rejeitados por anti-replay',
);
export const messagesInboundTotal = metrics.counter('messages_inbound_total', 'Mensagens inbound persistidas');
export const messagesOutboundTotal = metrics.counter('messages_outbound_total', 'Mensagens outbound criadas');
export const authFailuresTotal = metrics.counter('auth_failures_total', 'Falhas de autenticacao por motivo');
export const rateLimitHitsTotal = metrics.counter('rate_limit_hits_total', 'Requests bloqueados por rate limit');
export const authzDenialsTotal = metrics.counter('authz_denials_total', 'Negacoes de autorizacao por motivo');
export const mediaRecoveryClaimsTotal = metrics.counter(
  'media_recovery_claims_total',
  'Itens de media inbound reclamados pelo recovery worker',
);
export const mediaRecoveryOutcomesTotal = metrics.counter(
  'media_recovery_outcomes_total',
  'Desfechos do recovery de media inbound',
);
export const mediaRecoveryInFlight = metrics.gauge(
  'media_recovery_in_flight',
  'Tarefas de media inbound em processamento neste processo',
);
