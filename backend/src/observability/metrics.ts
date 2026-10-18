// NFR-6: Prometheus text exposition (version 0.0.4).
export interface Gauge { name: string; help: string; type: 'gauge' | 'counter'; value: number; labels?: Record<string, string> }

export function renderMetrics(gauges: Gauge[]): string {
  const lines: string[] = [];
  for (const g of gauges) {
    lines.push(`# HELP ${g.name} ${g.help}`);
    lines.push(`# TYPE ${g.name} ${g.type}`);
    const labels = g.labels && Object.keys(g.labels).length
      ? '{' + Object.entries(g.labels).map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '_')}"`).join(',') + '}'
      : '';
    lines.push(`${g.name}${labels} ${Number.isFinite(g.value) ? g.value : 0}`);
  }
  return lines.join('\n') + '\n';
}

/** Live connection gauge shared by SSE and WebSocket endpoints. */
export const live = { connections: 0, httpRequests: 0 };

/** Aggregate ingest bitrate, sampled from the media server by MediaBridge. */
export const mediaBitrate = { kbps: 0 };
