import net from 'node:net';
import { redisReady } from '../queue/redis-ping.js';
import { live, mediaBitrate, renderMetrics } from './metrics.js';

describe('Prometheus exposition (NFR-6)', () => {
  it('renders HELP/TYPE/value lines with escaped labels', () => {
    const text = renderMetrics([
      { name: 'nascon_dlq_depth', help: 'DLQ depth', type: 'gauge', value: 3 },
      { name: 'nascon_qr_scans_total', help: 'Scans', type: 'counter', value: Number.NaN, labels: { family: 'mob"ile' } },
    ]);
    expect(text).toContain('# TYPE nascon_dlq_depth gauge\nnascon_dlq_depth 3\n');
    expect(text).toContain('nascon_qr_scans_total{family="mob_ile"} 0\n');
    expect(text.endsWith('\n')).toBe(true);
    expect(live.connections).toBeGreaterThanOrEqual(0);
    expect(mediaBitrate.kbps).toBeGreaterThanOrEqual(0);
  });
});

describe('Redis readiness probe', () => {
  afterEach(() => { delete process.env.REDIS_URL; });

  it('is ready without Redis configured, not ready on a closed port, ready on +PONG', async () => {
    expect(await redisReady()).toBe(true);
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    expect(await redisReady(300)).toBe(false);
    const server = net.createServer((s) => s.on('data', () => s.write('+PONG\r\n')));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
    expect(await redisReady(1000)).toBe(true);
    server.close();
  });
});
