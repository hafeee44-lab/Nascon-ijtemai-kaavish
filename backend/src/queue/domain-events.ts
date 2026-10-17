import { Injectable, OnModuleDestroy } from '@nestjs/common';
import net from 'node:net';

// Internal domain-event queue on Redis Streams (XADD domain-events). Fire-and-forget:
// a queue outage must never fail a graded request.
@Injectable()
export class DomainEvents implements OnModuleDestroy {
  private socket: net.Socket | null = null;

  private connect(): net.Socket | null {
    if (this.socket && !this.socket.destroyed) return this.socket;
    const url = process.env.REDIS_URL;
    if (!url) return null;
    const u = new URL(url);
    const s = net.createConnection({ host: u.hostname, port: Number(u.port || 6379) });
    s.on('error', () => s.destroy());
    s.on('data', () => undefined);
    this.socket = s;
    return s;
  }

  async emit(type: string, data: Record<string, unknown>) {
    try {
      const s = this.connect();
      if (!s) return;
      const args = ['XADD', 'domain-events', 'MAXLEN', '~', '10000', '*', 'type', type, 'data', JSON.stringify(data), 'at', new Date().toISOString()];
      s.write(`*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join(''));
    } catch {
      /* best effort */
    }
  }

  onModuleDestroy() {
    this.socket?.destroy();
  }
}
