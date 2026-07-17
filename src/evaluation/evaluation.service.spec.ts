import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EvaluationService } from './evaluation.service';
import { FeatureFlag, FlagType } from '../flags/entities/feature-flag.entity';
import { FlagEnvironment, Environment } from '../flags/entities/flag-environment.entity';
import { RedisService } from '../redis/redis.service';

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
};

const mockFlagRepo = { findOne: jest.fn(), find: jest.fn() };
const mockEnvRepo = { findOne: jest.fn() };

function makeFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    id: 'flag-1',
    tenantId: 'tenant-1',
    flagKey: 'my-flag',
    name: 'My Flag',
    description: '',
    type: FlagType.BOOLEAN,
    defaultValue: false,
    isArchived: false,
    environments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: null as any,
    ...overrides,
  };
}

function makeEnv(overrides: Partial<FlagEnvironment> = {}): FlagEnvironment {
  return {
    id: 'env-1',
    flagId: 'flag-1',
    environment: Environment.PRODUCTION,
    isEnabled: true,
    rolloutPercentage: 100,
    targeting: {},
    variants: null,
    flag: null as any,
    ...overrides,
  };
}

describe('EvaluationService', () => {
  let service: EvaluationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationService,
        { provide: getRepositoryToken(FeatureFlag), useValue: mockFlagRepo },
        { provide: getRepositoryToken(FlagEnvironment), useValue: mockEnvRepo },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();
    service = module.get<EvaluationService>(EvaluationService);
  });

  describe('deterministic hashing', () => {
    it('returns the same bucket for the same flagKey + userId', () => {
      const bucket1 = (service as any).computeHash('my-flag', 'user-123');
      const bucket2 = (service as any).computeHash('my-flag', 'user-123');
      expect(bucket1).toBe(bucket2);
    });

    it('returns a value between 0 and 99', () => {
      for (let i = 0; i < 100; i++) {
        const bucket = (service as any).computeHash(`flag-${i}`, `user-${i}`);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(100);
      }
    });

    it('produces different buckets for different users', () => {
      const buckets = new Set<number>();
      for (let i = 0; i < 50; i++) {
        buckets.add((service as any).computeHash('my-flag', `user-${i}`));
      }
      expect(buckets.size).toBeGreaterThan(10);
    });
  });

  describe('evaluate', () => {
    const ctx = { tenantId: 'tenant-1', environment: 'production', userId: 'user-1' };

    it('returns default value when flag is disabled', async () => {
      const env = makeEnv({ isEnabled: false });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.findOne.mockResolvedValue(flag);

      const result = await service.evaluate(ctx, 'my-flag');
      expect(result.value).toBe(false);
      expect(result.reason).toBe('FLAG_DISABLED');
    });

    it('returns true for enabled boolean flag at 100% rollout', async () => {
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 100 });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.findOne.mockResolvedValue(flag);

      const result = await service.evaluate(ctx, 'my-flag');
      expect(result.value).toBe(true);
      expect(result.reason).toBe('ENABLED');
    });

    it('returns defaultValue for users outside rollout percentage', async () => {
      // Use rolloutPercentage=0 so ALL users are outside rollout
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 0 });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.findOne.mockResolvedValue(flag);

      const result = await service.evaluate(ctx, 'my-flag');
      expect(result.value).toBe(false);
      expect(result.reason).toBe('NOT_IN_ROLLOUT');
    });

    it('is deterministic: same user gets same result across calls', async () => {
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 50 });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.findOne.mockResolvedValue(flag);

      const result1 = await service.evaluate(ctx, 'my-flag');
      mockRedis.get.mockResolvedValue(null);
      mockFlagRepo.findOne.mockResolvedValue(flag);
      const result2 = await service.evaluate(ctx, 'my-flag');
      expect(result1.value).toBe(result2.value);
    });

    it('selects variant for string flag', async () => {
      const variants = [
        { value: 'control', weight: 50 },
        { value: 'treatment', weight: 50 },
      ];
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 100, variants });
      const flag = makeFlag({ type: FlagType.STRING, defaultValue: 'control', environments: [env] });
      mockFlagRepo.findOne.mockResolvedValue(flag);

      const result = await service.evaluate(ctx, 'my-flag');
      expect(['control', 'treatment']).toContain(result.value);
      expect(result.reason).toBe('VARIANT_MATCH');
    });

    it('throws NotFoundException for missing flag', async () => {
      mockFlagRepo.findOne.mockResolvedValue(null);
      await expect(service.evaluate(ctx, 'nonexistent')).rejects.toThrow('Flag \'nonexistent\' not found');
    });
  });

  describe('evaluateBulk', () => {
    it('returns evaluation for all active flags', async () => {
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 100 });
      const flags = [
        makeFlag({ flagKey: 'flag-a', environments: [env] }),
        makeFlag({ flagKey: 'flag-b', environments: [env] }),
      ];
      mockFlagRepo.find.mockResolvedValue(flags);

      const ctx = { tenantId: 'tenant-1', environment: 'production', userId: 'user-1' };
      const results = await service.evaluateBulk(ctx);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.flagKey)).toEqual(expect.arrayContaining(['flag-a', 'flag-b']));
    });

    it('returns empty array when no flags exist', async () => {
      mockFlagRepo.find.mockResolvedValue([]);
      const results = await service.evaluateBulk({ tenantId: 't1', environment: 'production', userId: 'u1' });
      expect(results).toEqual([]);
    });
  });

  describe('percentage rollout distribution', () => {
    it('approximately distributes users across 50% rollout', () => {
      // With 50% rollout, approximately half of users should be in
      let inRollout = 0;
      const total = 1000;
      for (let i = 0; i < total; i++) {
        const bucket = (service as any).computeHash('test-flag', `user-${i}`);
        if (bucket < 50) inRollout++;
      }
      // Allow 10% margin
      expect(inRollout).toBeGreaterThan(total * 0.4);
      expect(inRollout).toBeLessThan(total * 0.6);
    });
  });
});
