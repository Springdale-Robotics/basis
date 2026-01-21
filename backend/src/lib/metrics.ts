import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { config } from '../config/index.js';

export const registry = new Registry();

// Collect default Node.js metrics
if (config.ENABLE_METRICS) {
  collectDefaultMetrics({ register: registry });
}

// HTTP request metrics
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

// Job queue metrics
export const jobProcessingDuration = new Histogram({
  name: 'job_processing_duration_seconds',
  help: 'Background job processing time',
  labelNames: ['job_type', 'status'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [registry],
});

export const jobsTotal = new Counter({
  name: 'jobs_total',
  help: 'Total background jobs processed',
  labelNames: ['job_type', 'status'],
  registers: [registry],
});

export const activeJobs = new Gauge({
  name: 'active_jobs',
  help: 'Currently active jobs',
  labelNames: ['job_type'],
  registers: [registry],
});

// WebSocket metrics
export const activeWebsocketConnections = new Gauge({
  name: 'active_websocket_connections',
  help: 'Current WebSocket connections',
  labelNames: ['household_id'],
  registers: [registry],
});

// Database metrics
export const databaseQueryDuration = new Histogram({
  name: 'database_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

// Circuit breaker metrics
export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'],
  registers: [registry],
});

// Sync metrics
export const syncOperationsTotal = new Counter({
  name: 'sync_operations_total',
  help: 'Total sync operations with connected households',
  labelNames: ['direction', 'resource_type', 'status'],
  registers: [registry],
});

// Storage metrics
export const storageUsageBytes = new Gauge({
  name: 'storage_usage_bytes',
  help: 'Storage usage in bytes',
  labelNames: ['type'],
  registers: [registry],
});

// Auth metrics
export const authEventsTotal = new Counter({
  name: 'auth_events_total',
  help: 'Total authentication events',
  labelNames: ['event_type', 'status'],
  registers: [registry],
});

export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

export function recordHttpRequest(
  method: string,
  route: string,
  status: number,
  durationMs: number
): void {
  const labels = { method, route, status: String(status) };
  httpRequestDuration.observe(labels, durationMs / 1000);
  httpRequestsTotal.inc(labels);
}

export function recordJobCompletion(
  jobType: string,
  status: 'completed' | 'failed',
  durationMs: number
): void {
  jobProcessingDuration.observe({ job_type: jobType, status }, durationMs / 1000);
  jobsTotal.inc({ job_type: jobType, status });
}
