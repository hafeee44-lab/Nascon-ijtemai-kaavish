import { NestFactory } from '@nestjs/core';
import express from 'express';
import { AppModule } from './app.module.js';
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
  app.useGlobalFilters(new ErrorFilter());
  app.enableCors();

  const db = app.get(Db);
  await db.init();
  const seeded = await db.query(`SELECT 1 FROM meta WHERE key='seeded'`);
  if (!seeded.rows.length) await resetAll(db, await lastSeed(db), { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 });

  await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
}
await bootstrap();
