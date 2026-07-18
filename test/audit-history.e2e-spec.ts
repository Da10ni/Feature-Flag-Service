import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// The spec requires the audit log to record "the previous value". That is easy to get
// subtly wrong: a shallow copy of the flag shares its `environments` array, so mutating an
// environment config before writing the audit row silently rewrites the "previous" value
// into the new one. These tests pin the observable behaviour end to end.
describe('Audit History (Integration)', () => {
  let app: INestApplication;
  let tenantId: string;
  let apiKey: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const unique = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('x-admin-key', process.env.ADMIN_API_KEY!)
      .send({ name: `Audit ${unique}`, slug: `audit-${unique}` });
    expect(res.status).toBe(201);
    tenantId = res.body.id;
    apiKey = res.body.apiKey;

    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantId}/flags`)
      .set('x-api-key', apiKey)
      .send({
        flagKey: 'audited',
        name: 'Audited',
        type: 'boolean',
        defaultValue: false,
        environments: [
          {
            environment: 'production',
            isEnabled: false,
            rolloutPercentage: 10,
          },
        ],
      });

    await request(app.getHttpServer())
      .put(`/api/v1/tenants/${tenantId}/flags/audited`)
      .set('x-api-key', apiKey)
      .send({
        environment: 'production',
        isEnabled: true,
        rolloutPercentage: 90,
      });
  });

  afterAll(async () => {
    await app.close();
  });

  const prodEnv = (value: any) =>
    value?.environments?.find((e: any) => e.environment === 'production');

  it('records the pre-change environment config as previousValue', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/flags/audited/history`)
      .set('x-api-key', apiKey);

    const update = res.body.find((e: any) => e.action === 'UPDATED');
    expect(update).toBeDefined();

    // The whole point: previous must show the OLD values, not a copy of the new ones.
    expect(prodEnv(update.previousValue)).toMatchObject({
      isEnabled: false,
      rolloutPercentage: 10,
    });
    expect(prodEnv(update.newValue)).toMatchObject({
      isEnabled: true,
      rolloutPercentage: 90,
    });
  });

  it('records who changed it, when, and keeps entries chronological', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/flags/audited/history`)
      .set('x-api-key', apiKey);

    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body.map((e: any) => e.action)).toContain('CREATED');

    for (const entry of res.body) {
      expect(entry.changedBy).toBeTruthy();
      expect(entry.createdAt).toBeTruthy();
    }

    // Newest first — the endpoint is for "what changed recently".
    const times = res.body.map((e: any) => new Date(e.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('never exposes API key material on the tenant endpoint', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tenants/me')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(
      /apiKeyHash|apiKeyLookup|\$2[aby]\$/,
    );
  });
});
