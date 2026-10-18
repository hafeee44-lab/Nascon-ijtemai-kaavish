import net from 'node:net';

/** Readiness probe for /health: RESP PING → +PONG within 1 s (true when no Redis is configured). */
export function redisReady(timeoutMs = 1000): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return Promise.resolve(true);
  const u = new URL(url);
  return new Promise((resolve) => {
    const s = net.createConnection({ host: u.hostname, port: Number(u.port || 6379) });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.on('error', () => done(false));
    s.on('connect', () => s.write('*1\r\n$4\r\nPING\r\n'));
    s.on('data', (d) => done(d.toString().startsWith('+PONG')));
  });
}
