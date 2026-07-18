import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const slug = () =>
      `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // AdminKeyGuard is enforced in the suite (see test/setup-env.ts), so registration
    // carries the admin key. Statuses are asserted here so a setup failure surfaces as
    // "expected 201" rather than as confusing 404s in every test below.
    const resA = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('x-admin-key', process.env.ADMIN_API_KEY!)
      .send({ name: `Tenant A ${Date.now()}`, slug: slug() });
    expect(resA.status).toBe(201);
    tenantAId = resA.body.id;
    tenantAApiKey = resA.body.apiKey;

    const resB = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('x-admin-key', process.env.ADMIN_API_KEY!)
      .send({ name: `Tenant B ${Date.now()}`, slug: slug() });
    expect(resB.status).toBe(201);
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
      .send({
        flagKey: 'b-only-flag',
        name: 'B Only',
        type: 'boolean',
        defaultValue: false,
      });

    const listA = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantAId}/flags`)
      .set('x-api-key', tenantAApiKey);

    const flagKeys = listA.body.map((f: any) => f.flagKey);
    expect(flagKeys).not.toContain('b-only-flag');
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/tenants/${tenantAId}/flags`,
    );
    expect(res.status).toBe(401);
  });

  // Tenant registration mints an API key, so an open endpoint means anyone can provision
  // themselves credentials. These two pin AdminKeyGuard: if it ever regresses to allowing
  // unkeyed registration, they fail.
  it('should reject tenant registration without an admin key', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .send({ name: `Unauthorized ${Date.now()}`, slug: `unauth-${Date.now()}` });
    expect(res.status).toBe(401);
  });

  it('should reject tenant registration with a wrong admin key', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tenants')
      .set('x-admin-key', 'not-the-admin-key')
      .send({ name: `WrongKey ${Date.now()}`, slug: `wrong-${Date.now()}` });
    expect(res.status).toBe(401);
  });
});
