import { createApp, type AppOptions } from './app.ts';

export function startServer(opts: AppOptions & { port?: number; hostname?: string } = {}): { server: ReturnType<typeof Bun.serve>; live: boolean } {
  const app = createApp(opts);
  const server = Bun.serve({
    port: opts.port ?? Number(process.env.PORT ?? 8787),
    hostname: opts.hostname ?? process.env.HOST ?? 'localhost',
    // SSE streams stay open; the stream sends a ping every 15s.
    idleTimeout: 60,
    fetch: (req) => app.fetch(req),
  });
  return { server, live: Boolean(app.client) };
}

if (import.meta.main) {
  const { server, live } = startServer();
  console.log(`MikoMarket server on http://${server.hostname}:${server.port}  [${live ? 'TradeStation live data ON' : 'offline: TradeStation not configured'}]`);
}
