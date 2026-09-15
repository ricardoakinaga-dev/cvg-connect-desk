type Timer = ReturnType<typeof setInterval>;
type SetIntervalFunction = (handler: () => void, timeout: number) => Timer;
type ClearIntervalFunction = (timer: Timer) => void;

/** Mantém um único ciclo de polling ativo por vez. */
export function createNoOverlapPoller(
  poll: () => Promise<void>,
  intervalMs: number,
  setIntervalFunction: SetIntervalFunction = setInterval,
  clearIntervalFunction: ClearIntervalFunction = clearInterval,
) {
  let running = false;
  const idleWaiters: Array<() => void> = [];
  const timer = setIntervalFunction(() => {
    void run();
  }, intervalMs);

  async function run(): Promise<boolean> {
    if (running) return false;

    running = true;
    try {
      await poll();
      return true;
    } finally {
      running = false;
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  }

  function waitForIdle(): Promise<void> {
    if (!running) return Promise.resolve();
    return new Promise<void>((resolve) => idleWaiters.push(resolve));
  }

  return {
    run,
    stop: () => clearIntervalFunction(timer),
    waitForIdle,
    isRunning: () => running,
  };
}
