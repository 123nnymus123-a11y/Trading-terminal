import client from 'prom-client';

const collectDefault = true;
if (collectDefault) {
  client.collectDefaultMetrics({ timeout: 5000 });
}

export const httpRequestCounter = new client.Counter({
  name: 'tc_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const httpErrorCounter = new client.Counter({
  name: 'tc_http_errors_total',
  help: 'Total HTTP errors',
  labelNames: ['route', 'status'],
});

export const httpRequestDurationMs = new client.Histogram({
  name: 'tc_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const aiQueueGauge = new client.Gauge({
  name: 'tc_ai_queue_length',
  help: 'AI job queue length',
});

export const aiQueueRunningGauge = new client.Gauge({
  name: 'tc_ai_queue_running',
  help: 'AI jobs currently running',
});

export default client;
