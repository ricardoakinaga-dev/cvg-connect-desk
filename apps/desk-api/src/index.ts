import 'dotenv/config';
import { initTracing } from '@cvg/tracing';
import { buildDeskApiApp } from './app.ts';

async function bootstrap() {
  const tracing = await initTracing();
  const app = await buildDeskApiApp();

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Recebido ${signal}, encerrando graciosamente...`);
      await app.close();
      await tracing.shutdown();
      process.exit(0);
    });
  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Server running on http://0.0.0.0:${port}`);
  app.log.info(`API docs available at http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
