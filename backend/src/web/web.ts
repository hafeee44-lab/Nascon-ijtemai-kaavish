import type { Express } from 'express';

// Guest Web Player (/web/*) — full page is built in Phase 3.
export function serveWeb(app: Express) {
  app.get(/^\/web\/.*/, (_req, res) => {
    res.type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NaSCon Live</title></head><body><main id="app">Loading…</main></body></html>');
  });
}
