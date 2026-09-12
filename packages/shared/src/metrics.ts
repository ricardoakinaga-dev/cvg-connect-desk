/**
 * Registro de métricas estilo Prometheus (Phase 6 §9.1).
 * In-process, sem dependências: counters, gauges e histogramas simplificados
 * (buckets cumulativos + sum/count). Exposto em GET /metrics.
 *
 * Escopo por processo: cada runtime (api/worker/realtime) expõe o seu.
 * Agregação cross-replica é papel do Prometheus (sum by).
 */

export type LabelValues = Record<string, string | number | boolean>;

function labelsKey(labels: LabelValues): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${JSON.stringify(labels[k])}`)
    .join(',');
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export class Counter {
  private values = new Map<string, { labels: LabelValues; value: number }>();

  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  inc(labels: LabelValues = {}, amount = 1): void {
    const key = labelsKey(labels);
    const entry = this.values.get(key) || { labels: { ...labels }, value: 0 };
    entry.value += amount;
    this.values.set(key, entry);
  }

  get(labels: LabelValues = {}): number {
    return this.values.get(labelsKey(labels))?.value ?? 0;
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
    } else {
      this.values.set(labelsKey(a), { labels: { ...a }, value: b ?? 0 });
    }
  }

  inc(labels: LabelValues = {}, amount = 1): void {
    const key = labelsKey(labels);
    const entry = this.values.get(key) || { labels: { ...labels }, value: 0 };
    entry.value += amount;
    this.values.set(key, entry);
  }

  dec(labels: LabelValues = {}, amount = 1): void {
    this.inc(labels, -amount);
  }

  get(labels: LabelValues = {}): number {
    return this.values.get(labelsKey(labels))?.value ?? 0;
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
    const key = labelsKey(labels);
    let entry = this.counts.get(key);
    if (!entry) {
      entry = { labels: { ...labels }, counts: this.buckets.map(() => 0), sum: 0, total: 0 };
      this.counts.set(key, entry);
    }
    entry.total += 1;
    entry.sum += value;
    this.buckets.forEach((bound, i) => {
      if (value <= bound) entry!.counts[i] += 1;
    });
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
