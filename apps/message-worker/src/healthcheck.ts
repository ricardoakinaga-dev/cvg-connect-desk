/**
 * Healthcheck do processo real do message-worker.
 * Consulta o endpoint do próprio processo, que inclui progresso do loop e
 * idade da fila; um processo novo fazendo apenas SELECT 1 não é suficiente.
 */
async function main(): Promise<void> {
  const port = Number(process.env.WORKER_HEALTH_PORT) || 9090;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readiness`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error(`worker readiness returned HTTP ${response.status}`);
    }
    process.exit(0);
  } catch (error) {
    console.error('[worker-healthcheck] unhealthy:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void main();
