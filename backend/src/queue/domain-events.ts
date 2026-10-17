import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import net from 'node:net';

export interface DomainEvent {
  type: string;
  data: Record<string, unknown>;
  at: string;
}

// Domain events go two ways: durably onto the internal queue (Redis Streams, XADD domain-events)
// for workers, and onto an in-process bus that the realtime SSE layer fans out to clients.
// Publishing is fire-and-forget: a queue outage must never fail a graded request.
@Injectable()
export class DomainEvents implements OnModuleDestroy {
  private socket: net.Socket | null = null;
  readonly bus = new EventEmitter().setMaxListeners(1000);

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
    const event: DomainEvent = { type, data, at: new Date().toISOString() };
    this.bus.emit('event', event);
    try {
      const s = this.connect();
      if (!s) return;
      const args = ['XADD', 'domain-events', 'MAXLEN', '~', '10000', '*', 'type', type, 'data', JSON.stringify(data), 'at', event.at];
      s.write(`*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join(''));
    } catch {
      /* best effort */
    }
  }

  onModuleDestroy() {
    this.socket?.destroy();
  }
}
