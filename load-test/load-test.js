import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

/**
 * Load test for the flag evaluation endpoints.
 *
 * Spreads load across several tenants rather than hammering one. That is not incidental:
 * the service enforces a PER-TENANT rate limit, so a single-tenant test at a few hundred
 * rps measures the throttler, not the evaluation engine — it reports ~80% errors while the
 * service is behaving exactly as designed. Driving N tenants concurrently is also the
 * realistic shape for a multi-tenant platform, and it exercises tenant isolation under load.
 *
 * Throttled responses are counted separately from real failures, so a 429 is never silently
 * scored as a service error.
 */

const errorRate = new Rate('errors');
const evalLatency = new Trend('evaluation_latency', true);
const throttled = new Counter('throttled_429');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TENANTS = Number(__ENV.TENANTS || 8);
const ADMIN_KEY = __ENV.ADMIN_API_KEY || '';
const FLAG_KEY = 'load-test-flag';

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

function headers(apiKey) {
  return { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey } };
}

// Runs once before the load phase: provisions the tenants and the flag under test, so the
// script is self-contained and doesn't depend on hand-seeded data.
export function setup() {
  const adminHeaders = { 'Content-Type': 'application/json' };
  if (ADMIN_KEY) adminHeaders['x-admin-key'] = ADMIN_KEY;

  const keys = [];
  for (let i = 0; i < TENANTS; i++) {
    const stamp = `${Date.now()}-${i}-${Math.floor(Math.random() * 1e6)}`;
    const res = http.post(
      `${BASE_URL}/api/v1/tenants`,
      JSON.stringify({ name: `LoadTest ${stamp}`, slug: `loadtest-${stamp}` }),
      { headers: adminHeaders },
    );
    if (res.status !== 201) {
      throw new Error(`tenant provisioning failed (${res.status}): ${res.body}`);
    }
    const tenant = res.json();

    const flag = http.post(
      `${BASE_URL}/api/v1/tenants/${tenant.id}/flags`,
      JSON.stringify({
        flagKey: FLAG_KEY,
        name: 'Load Test Flag',
        type: 'string',
        defaultValue: 'off',
        // A partial rollout with variants exercises both hash paths per evaluation,
        // so the numbers reflect the real cost of the engine rather than a trivial lookup.
        environments: [
          {
            environment: 'production',
            isEnabled: true,
            rolloutPercentage: 50,
            variants: [
              { value: 'control', weight: 50 },
              { value: 'treatment', weight: 50 },
            ],
          },
        ],
      }),
      headers(tenant.apiKey),
    );
    if (flag.status !== 201) {
      throw new Error(`flag creation failed (${flag.status}): ${flag.body}`);
    }
    keys.push(tenant.apiKey);
  }
  return { keys };
}

export default function (data) {
  // Each VU sticks to one tenant, so load divides evenly across tenants.
  const apiKey = data.keys[__VU % data.keys.length];
  const params = headers(apiKey);
  const userId = `user-${Math.floor(Math.random() * 100000)}`;

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/v1/evaluate`,
    JSON.stringify({ environment: 'production', user_id: userId, flag_key: FLAG_KEY }),
    params,
  );
  evalLatency.add(Date.now() - start);
  if (res.status === 429) throttled.add(1);
  errorRate.add(!check(res, { 'evaluate status 200': (r) => r.status === 200 }));

  const bulk = http.post(
    `${BASE_URL}/api/v1/evaluate/bulk`,
    JSON.stringify({ environment: 'production', user_id: userId }),
    params,
  );
  if (bulk.status === 429) throttled.add(1);
  errorRate.add(!check(bulk, { 'bulk status 200': (r) => r.status === 200 }));

  sleep(0.1);
}
