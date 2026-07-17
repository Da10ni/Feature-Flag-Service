import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Tenant Isolation (Integration)', () => {
  let app: INestApplication;
  let tenantAId: string;
  let tenantAApiKey: string;
  let tenantBId: string;
  let tenantBApiKey: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const slug = () => `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const resA = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .send({ name: `Tenant A ${Date.now()}`, slug: slug() });
    tenantAId = resA.body.id;
    tenantAApiKey = resA.body.apiKey;

    const resB = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .send({ name: `Tenant B ${Date.now()}`, slug: slug() });
    tenantBId = resB.body.id;
    tenantBApiKey = resB.body.apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a flag for tenant A', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantAId}/flags`)
      .set('x-api-key', tenantAApiKey)
      .send({
        flagKey: 'isolation-test-flag',
        name: 'Isolation Test',
        type: 'boolean',
        defaultValue: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.flagKey).toBe('isolation-test-flag');
  });

  it('should NOT allow tenant B to access tenant A flags', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantAId}/flags`)
      .set('x-api-key', tenantBApiKey);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should NOT allow tenant B to create a flag under tenant A', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantAId}/flags`)
      .set('x-api-key', tenantBApiKey)
      .send({
        flagKey: 'injected-flag',
        name: 'Injected',
        type: 'boolean',
        defaultValue: false,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('tenant A cannot see tenant B flags', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/tenants/${tenantBId}/flags`)
      .set('x-api-key', tenantBApiKey)
      .send({ flagKey: 'b-only-flag', name: 'B Only', type: 'boolean', defaultValue: false });

    const listA = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantAId}/flags`)
      .set('x-api-key', tenantAApiKey);

    const flagKeys = listA.body.map((f: any) => f.flagKey);
    expect(flagKeys).not.toContain('b-only-flag');
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantAId}/flags`);
    expect(res.status).toBe(401);
  });
});
