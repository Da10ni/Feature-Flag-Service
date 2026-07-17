import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const evalLatency = new Trend('evaluation_latency', true);

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '60s', target: 100 },
    { duration: '30s', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    errors: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TENANT_ID = __ENV.TENANT_ID || 'your-tenant-id';

const EVALUATE_PAYLOAD = JSON.stringify({
  tenantId: TENANT_ID,
  environment: 'production',
  userId: `user-${Math.random()}`,
});

const params = {
  headers: { 'Content-Type': 'application/json' },
};

export default function () {
  // Single flag evaluation
  const userId = `user-${Math.floor(Math.random() * 10000)}`;
  const payload = JSON.stringify({
    tenantId: TENANT_ID,
    environment: 'production',
    userId,
    flagKey: 'test-flag',
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/evaluate`, payload, params);
  evalLatency.add(Date.now() - start);

  const ok = check(res, {
    'status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  errorRate.add(!ok);

  // Bulk evaluation
  const bulkPayload = JSON.stringify({
    tenantId: TENANT_ID,
    environment: 'production',
    userId,
  });
  const bulkRes = http.post(`${BASE_URL}/api/v1/evaluate/bulk`, bulkPayload, params);
  check(bulkRes, { 'bulk status 200': (r) => r.status === 200 });

  sleep(0.1);
}
