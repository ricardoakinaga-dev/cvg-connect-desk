/**
 * Stress Test Script using k6
 * V4: Stress test with explicit scenario-threshold output in summary
 *
 * Usage:
 *   k6 run stress-test.js
 *   k6 run stress-test.js --env TARGET_URL=https://api.example.com
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend } from 'k6/metrics';

// Custom metrics
const loginDuration = new Trend('login_duration');
const conversationLoadDuration = new Trend('conversation_load_duration');

// Counters used to calculate 5xx error rate independent of k6 threshold behavior
let totalRequestsForErrorRate = 0;
let total5xxResponses = 0;

// Configuration
const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const API_BASE = BASE_URL;
const PERF_PROFILE = __ENV.QA_PERF_PROFILE || 'production';
const P95_THRESHOLD_MS = (() => {
  const envValue = Number(__ENV.P95_THRESHOLD_MS || '');
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }
  return PERF_PROFILE === 'local-docker' ? 1500 : 500;
})();
const DEFAULT_SUMMARY_VALUE = 0;
const SUMMARY_PATH = __ENV.SUMMARY_PATH || 'stress-test/summary.json';

function safeJson(res) {
  try {
    return res.json();
  } catch (error) {
    return null;
  }
}

function metricValue(metric, key, fallback = DEFAULT_SUMMARY_VALUE) {
  if (!metric || !metric.values || metric.values[key] === undefined || Number.isNaN(metric.values[key])) {
    return fallback;
  }
  return metric.values[key];
}

function resolveMetric(metrics, name) {
  if (!metrics) {
    return null;
  }

  if (metrics[name]) {
    return metrics[name];
  }

  const matchedEntry = Object.entries(metrics).find(([metricName]) => metricName.startsWith(`${name}{`));
  return matchedEntry ? matchedEntry[1] : null;
}

function trackRequest(res) {
  totalRequestsForErrorRate += 1;
  const status = res?.status || 0;
  if (status >= 500 || status === 0) {
    total5xxResponses += 1;
  }
}

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Ramp up to 50 users
    { duration: '1m', target: 50 },    // Stay at 50 users
    { duration: '30s', target: 100 },  // Spike to 100 users
    { duration: '1m', target: 100 },   // Stay at 100 users
    { duration: '30s', target: 0 },    // Ramp down
  ],
};

// Test data
const TEST_CREDENTIALS = {
  email: __ENV.TEST_EMAIL || 'e2e-admin@cvg.test',
  password: __ENV.TEST_PASSWORD || 'E2eSmokePass!2026',
};

function login() {
  const start = Date.now();
  const res = http.post(
    `${API_BASE}/auth/login`,
    JSON.stringify(TEST_CREDENTIALS),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'Login' },
    }
  );
  trackRequest(res);
  loginDuration.add(Date.now() - start);
  const body = safeJson(res);
  const sessionCookie = res.cookies?.cvg_session?.[0]?.value;
  const csrfCookie = res.cookies?.cvg_csrf?.[0]?.value;

  const success = check(res, {
    'login status 200': (r) => r.status === 200,
    'login has session cookie': () => Boolean(sessionCookie),
    'login has csrf cookie': () => Boolean(csrfCookie),
  });

  if (!success) {
    return null;
  }

  return {
    cookieHeader: `cvg_session=${sessionCookie}; cvg_csrf=${csrfCookie}`,
    csrfToken: csrfCookie,
    userId: body?.user?.id || null,
  };
}

export function setup() {
  const session = login();
  return { session };
}

function authHeaders(session) {
  return {
    Cookie: session.cookieHeader,
  };
}

function getDashboard(session) {
  const res = http.get(
    `${API_BASE}/metrics/summary`,
    {
      headers: authHeaders(session),
      tags: { name: 'Dashboard' },
    }
  );
  trackRequest(res);

  check(res, {
    'dashboard status 200': (r) => r.status === 200,
  });
}

function getConversations(session) {
  const res = http.get(
    `${API_BASE}/conversations?limit=50`,
    {
      headers: authHeaders(session),
      tags: { name: 'Conversations' },
    }
  );
  trackRequest(res);

  const success = check(res, {
    'conversations status 200': (r) => r.status === 200,
  });

  return success ? res.json() : null;
}

function getMessages(session, conversationId) {
  const start = Date.now();
  const res = http.get(
    `${API_BASE}/conversations/${conversationId}/messages`,
    {
      headers: authHeaders(session),
      tags: { name: 'Messages' },
    }
  );
  conversationLoadDuration.add(Date.now() - start);
  trackRequest(res);

  check(res, {
    'messages status 200': (r) => r.status === 200,
  });
}

function getTasks(session) {
  const res = http.get(
    `${API_BASE}/tasks`,
    {
      headers: authHeaders(session),
      tags: { name: 'Tasks' },
    }
  );
  trackRequest(res);

  check(res, {
    'tasks status 200': (r) => r.status === 200,
  });
}

function getHealth() {
  const res = http.get(`${BASE_URL}/health`, {
    tags: { name: 'Health' },
  });
  trackRequest(res);

  check(res, {
    'health status 200': (r) => r.status === 200,
  });
}

export default function (data) {
  const session = data?.session || null;
  if (!session) return;

  group('Health Check', () => {
    getHealth();
  });

  group('Authentication', () => {
    check(session, { 'setup returned session cookie': (value) => value?.cookieHeader !== null });
  });

  group('Dashboard Metrics', () => {
    getDashboard(session);
  });

  group('Conversations', () => {
    const conversations = getConversations(session);
    if (!conversations || !conversations.data) return;

    // Get messages for first 5 conversations
    const convs = conversations.data.slice(0, 5);
    for (const conv of convs) {
      getMessages(session, conv.id);
      sleep(0.1);
    }
  });

  group('Tasks', () => {
    getTasks(session);
  });

  // Think time between iterations
  sleep(1);
}

export function handleSummary(data) {
  const { metrics } = data;
  const checksMetric = metrics.checks || {};
  const checksPasses = metricValue(checksMetric, 'passes', 0);
  const checksFails = metricValue(checksMetric, 'fails', 0);
  const totalChecks = checksPasses + checksFails;
  const checksRate = totalChecks > 0 ? checksPasses / totalChecks : 0;
  const duration = resolveMetric(metrics, 'http_req_duration');
  const totalRequests = metricValue(metrics.http_reqs, 'count');
  const p95Duration = metricValue(duration, 'p(95)');
  const errorRate5xx = totalRequestsForErrorRate > 0
    ? total5xxResponses / totalRequestsForErrorRate
    : 0;

  const scenarioThresholds = {
    durationP95: {
      thresholdMs: P95_THRESHOLD_MS,
      actualMs: p95Duration,
      passed: p95Duration < P95_THRESHOLD_MS,
    },
    errorRate5xx: {
      thresholdPercent: 1,
      actualPercent: errorRate5xx * 100,
      passed: errorRate5xx <= 0.01,
    },
    checksRate: {
      threshold: 0.99,
      actualRate: checksRate,
      passed: checksRate >= 0.99,
    },
  };
  const scenarioPassed = scenarioThresholds.durationP95.passed
    && scenarioThresholds.errorRate5xx.passed
    && scenarioThresholds.checksRate.passed;

  const scenarioSummary = {
    scenario_thresholds: {
      duration_p95_ms: {
        threshold: scenarioThresholds.durationP95.thresholdMs,
        actual: scenarioThresholds.durationP95.actualMs,
        passed: scenarioThresholds.durationP95.passed,
      },
      error_rate_5xx_percent: {
        threshold: `${scenarioThresholds.errorRate5xx.thresholdPercent}%`,
        actual: scenarioThresholds.errorRate5xx.actualPercent,
        passed: scenarioThresholds.errorRate5xx.passed,
      },
      checks_rate: {
        threshold: `${(scenarioThresholds.checksRate.threshold * 100).toFixed(0)}%`,
        actual: scenarioThresholds.checksRate.actualRate,
        passed: scenarioThresholds.checksRate.passed,
      },
      scenario_passed: scenarioPassed,
    },
  };

  let summary = '\n';
  summary += '='.repeat(60) + '\n';
  summary += '  STRESS TEST SUMMARY\n';
  summary += '='.repeat(60) + '\n\n';

  summary += `Total Requests:        ${totalRequests}\n`;
  summary += `Failed Requests (5xx):${total5xxResponses}\n`;
  summary += `Error Rate:           ${(errorRate5xx * 100).toFixed(2)}%\n`;
  summary += `Checks Passed:        ${checksPasses}\n`;
  summary += `Checks Failed:        ${checksFails}\n`;
  summary += `Checks Rate:          ${(checksRate * 100).toFixed(2)}%\n\n`;

  summary += 'Response Time (http_req_duration):\n';
  summary += `  avg:     ${metricValue(duration, 'avg').toFixed(2)}ms\n`;
  summary += `  p(50):   ${metricValue(duration, 'med').toFixed(2)}ms\n`;
  summary += `  p(95):   ${p95Duration.toFixed(2)}ms\n`;
  summary += `  p(99):   ${metricValue(duration, 'p(99)').toFixed(2)}ms\n`;
  summary += `  max:     ${metricValue(duration, 'max').toFixed(2)}ms\n\n`;

  summary += 'Login Duration:\n';
  summary += `  avg:     ${metricValue(metrics.login_duration, 'avg').toFixed(2)}ms\n\n`;

  summary += 'Conversation Load Duration:\n';
  summary += `  avg:     ${metricValue(metrics.conversation_load_duration, 'avg').toFixed(2)}ms\n\n`;

  summary += '='.repeat(60) + '\n';
  summary += `Scenario thresholds:\n`;
  summary += `  p95 Response Duration < ${scenarioThresholds.durationP95.thresholdMs}ms: ${scenarioThresholds.durationP95.passed ? 'PASS' : 'FAIL'} (${scenarioThresholds.durationP95.actualMs.toFixed(2)}ms)\n`;
  summary += `  Error Rate 5xx <= ${scenarioThresholds.errorRate5xx.thresholdPercent}%: ${scenarioThresholds.errorRate5xx.passed ? 'PASS' : 'FAIL'} (${scenarioThresholds.errorRate5xx.actualPercent.toFixed(2)}%)\n`;
  summary += `  Checks success >= ${(scenarioThresholds.checksRate.threshold * 100).toFixed(0)}%: ${scenarioThresholds.checksRate.passed ? 'PASS' : 'FAIL'} (${(scenarioThresholds.checksRate.actualRate * 100).toFixed(2)}%)\n`;
  summary += `\nSCENARIO: ${scenarioPassed ? 'PASSED' : 'FAILED'}\n`;
  summary += '='.repeat(60) + '\n';

  return {
    stdout: summary,
    [SUMMARY_PATH]: JSON.stringify({
      scenario_thresholds: scenarioSummary.scenario_thresholds,
      summary: {
        total_requests: totalRequests,
        failed_5xx_requests: total5xxResponses,
        error_rate_5xx_percent: errorRate5xx * 100,
        checks_rate: checksRate,
        scenario_passed: scenarioPassed,
      },
    }, null, 2),
  };
}
