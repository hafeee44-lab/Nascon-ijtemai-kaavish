import { NestFactory } from '@nestjs/core';
import express from 'express';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module.js';
import { CostreamService } from './costream/costream.js';
import { Day2Controller } from './day2/day2.controller.js';
import { live } from './observability/metrics.js';
import { guestGuard } from './qr_guest/guest-guard.js';
import { DomainEvents } from './queue/domain-events.js';
import { serveWeb } from './web/web.js';
import { ErrorFilter } from './common/error.filter.js';
import { Db } from './db/db.service.js';
import { lastSeed, resetAll } from './db/seed.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: '1mb', type: () => true }));
  // Body-parser failures happen before Nest routing, so map them to the contract here.
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === 'entity.too.large')
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Body exceeds 1 MB.', details: {} } });
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError)
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON.', details: { fields: [] } } });
    return next(err);
  });
  app.use((_req: express.Request, _res: express.Response, next: express.NextFunction) => { live.httpRequests++; next(); });
  // FR-4.3: guest tokens are rejected on every write before any controller runs.
  app.use(guestGuard);
  serveWeb(app.getHttpAdapter().getInstance(), app);
  app.useGlobalFilters(new ErrorFilter());
  app.enableCors();

  const db = app.get(Db);
  await db.init();
  const seeded = await db.query(`SELECT 1 FROM meta WHERE key='seeded'`);
  if (!seeded.rows.length) await resetAll(db, await lastSeed(db), { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 });

  // NFR-2: 550 clients connect at once under k6 — a deep accept backlog avoids resets during ramp-up.
  await app.init();
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  await new Promise<void>((resolve) => server.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0', backlog: 4096 }, resolve));

  // NFR-1: ws://host:8080/ws/matches/{match_id} pushes the score on every appended event.
  const wss = new WebSocketServer({ noServer: true });
  const day2 = app.get(Day2Controller);
  const bus = app.get(DomainEvents).bus;
  // FR-3.3: ws://host:8080/ws/costream/{session_id}?player_id=… is broadcaster presence. When a
  // broadcaster's last socket closes and they do not reconnect within 1 s, hosting hands over (< 1.5 s).
  const costream = app.get(CostreamService);
  const presence = new Map<string, number>();
  app.getHttpServer().on('upgrade', (req: any, socket: any, head: any) => {
    const cs = /^\/ws\/costream\/([A-Za-z0-9_.:-]{1,64})\?(?:.*&)?player_id=([A-Za-z0-9_.:-]{1,64})/.exec(req.url ?? '');
    if (cs) {
      const key = `${cs[1]}|${cs[2]}`;
      return wss.handleUpgrade(req, socket, head, (ws) => {
        presence.set(key, (presence.get(key) ?? 0) + 1);
        live.connections++;
        ws.send(JSON.stringify({ type: 'presence', session_id: cs[1], player_id: cs[2], status: 'connected' }));
        const onEvent = (e: any) => {
          if (e.data?.session_id === cs[1] && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: e.type, ...e.data }));
        };
        bus.on('event', onEvent);
        ws.on('close', () => {
          live.connections--;
          bus.off('event', onEvent);
          presence.set(key, (presence.get(key) ?? 1) - 1);
          setTimeout(() => {
            if ((presence.get(key) ?? 0) <= 0) void costream.disconnect(cs[1], cs[2]).catch(() => undefined);
          }, 1000);
        });
      });
    }
    const m = /^\/ws\/matches\/([A-Za-z0-9_.:-]{1,64})/.exec(req.url ?? '');
    if (!m) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const matchId = m[1];
      live.connections++;
      const send = async () => {
        const s = await day2.scoreSnapshot(matchId);
        if (s && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'score', ...s }));
      };
      void send();
      const onEvent = (e: any) => {
        if (e.data?.match_id !== matchId) return;
        if (e.type === 'match.event_appended' || e.type === 'match.status_changed') void send();
        else if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: e.type, ...e.data }));
      };
      bus.on('event', onEvent);
      ws.on('close', () => {
        live.connections--;
        bus.off('event', onEvent);
      });
    });
  });
}
await bootstrap();
