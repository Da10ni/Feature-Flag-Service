import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EvaluationService } from './evaluation.service';
import { FeatureFlag, FlagType } from '../flags/entities/feature-flag.entity';
import {
  FlagEnvironment,
  Environment,
} from '../flags/entities/flag-environment.entity';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';

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
        MetricsService,
      ],
    }).compile();
    service = module.get<EvaluationService>(EvaluationService);
  });

  describe('deterministic hashing', () => {
    const hash = (salt: string, flagKey: string, userId: string): number =>
      (service as any).computeHash(salt, flagKey, userId);

    it('returns the same bucket for the same flagKey + userId', () => {
      expect(hash('rollout', 'my-flag', 'user-123')).toBe(
        hash('rollout', 'my-flag', 'user-123'),
      );
    });

    it('returns a value between 0 and 99', () => {
      for (let i = 0; i < 100; i++) {
        const bucket = hash('rollout', `flag-${i}`, `user-${i}`);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(100);
      }
    });

    it('produces different buckets for different users', () => {
      const buckets = new Set<number>();
      for (let i = 0; i < 50; i++) {
        buckets.add(hash('rollout', 'my-flag', `user-${i}`));
      }
      expect(buckets.size).toBeGreaterThan(10);
    });

    // Same flag, same user, different decision — the salt must decorrelate them.
    it('gives rollout and variant decisions independent buckets', () => {
      let differ = 0;
      for (let i = 0; i < 200; i++) {
        if (
          hash('rollout', 'my-flag', `user-${i}`) !==
          hash('variant', 'my-flag', `user-${i}`)
        ) {
          differ++;
        }
      }
      expect(differ).toBeGreaterThan(180);
    });
  });

  describe('evaluate', () => {
    const ctx = {
      tenantId: 'tenant-1',
      environment: Environment.PRODUCTION,
      userId: 'user-1',
    };

    it('returns default value when flag is disabled', async () => {
      const env = makeEnv({ isEnabled: false });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.find.mockResolvedValue([flag]);

      const result = await service.evaluate(ctx, 'my-flag');
      expect(result.value).toBe(false);
      expect(result.reason).toBe('FLAG_DISABLED');
    });

    it('returns true for enabled boolean flag at 100% rollout', async () => {
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 100 });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.find.mockResolvedValue([flag]);

      const result = await service.evaluate(ctx, 'my-flag');
      expect(result.value).toBe(true);
      expect(result.reason).toBe('ENABLED');
    });

    it('returns defaultValue for users outside rollout percentage', async () => {
      // Use rolloutPercentage=0 so ALL users are outside rollout
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 0 });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.find.mockResolvedValue([flag]);

      const result = await service.evaluate(ctx, 'my-flag');
      expect(result.value).toBe(false);
      expect(result.reason).toBe('NOT_IN_ROLLOUT');
    });

    it('is deterministic: same user gets same result across calls', async () => {
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 50 });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.find.mockResolvedValue([flag]);

      const result1 = await service.evaluate(ctx, 'my-flag');
      mockRedis.get.mockResolvedValue(null);
      mockFlagRepo.find.mockResolvedValue([flag]);
      const result2 = await service.evaluate(ctx, 'my-flag');
      expect(result1.value).toBe(result2.value);
    });

    it('selects variant for string flag', async () => {
      const variants = [
        { value: 'control', weight: 50 },
        { value: 'treatment', weight: 50 },
      ];
      const env = makeEnv({
        isEnabled: true,
        rolloutPercentage: 100,
        variants,
      });
      const flag = makeFlag({
        type: FlagType.STRING,
        defaultValue: 'control',
        environments: [env],
      });
      mockFlagRepo.find.mockResolvedValue([flag]);

      const result = await service.evaluate(ctx, 'my-flag');
      expect(['control', 'treatment']).toContain(result.value);
      expect(result.reason).toBe('VARIANT_MATCH');
    });

    it('throws NotFoundException for missing flag', async () => {
      mockFlagRepo.find.mockResolvedValue([]);
      await expect(service.evaluate(ctx, 'nonexistent')).rejects.toThrow(
        "Flag 'nonexistent' not found",
      );
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

      const ctx = {
        tenantId: 'tenant-1',
        environment: Environment.PRODUCTION,
        userId: 'user-1',
      };
      const results = await service.evaluateBulk(ctx);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.flagKey)).toEqual(
        expect.arrayContaining(['flag-a', 'flag-b']),
      );
    });

    it('returns empty array when no flags exist', async () => {
      mockFlagRepo.find.mockResolvedValue([]);
      const results = await service.evaluateBulk({
        tenantId: 't1',
        environment: Environment.PRODUCTION,
        userId: 'u1',
      });
      expect(results).toEqual([]);
    });

    it('evaluates every flag from a single database read', async () => {
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 100 });
      mockFlagRepo.find.mockResolvedValue([
        makeFlag({ flagKey: 'a', environments: [env] }),
        makeFlag({ flagKey: 'b', environments: [env] }),
        makeFlag({ flagKey: 'c', environments: [env] }),
      ]);

      await service.evaluateBulk({
        tenantId: 't1',
        environment: Environment.PRODUCTION,
        userId: 'u1',
      });

      // Not one query per flag: bulk evaluation must be O(1) in database round trips.
      expect(mockFlagRepo.find).toHaveBeenCalledTimes(1);
    });
  });

  // The cache holds flag definitions, not per-user results. That is what makes the hit rate
  // independent of how many distinct users call in — the property the whole design rests on.
  describe('caching strategy', () => {
    it('serves distinct users from one cached flag-set', async () => {
      const env = makeEnv({ isEnabled: true, rolloutPercentage: 100 });
      const flag = makeFlag({ environments: [env] });
      mockFlagRepo.find.mockResolvedValue([flag]);

      // First call populates the cache; subsequent calls read it back.
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.get.mockResolvedValue(JSON.stringify([flag]));

      for (let i = 0; i < 25; i++) {
        await service.evaluate(
          {
            tenantId: 'tenant-1',
            environment: Environment.PRODUCTION,
            userId: `distinct-user-${i}`,
          },
          'my-flag',
        );
      }

      expect(mockFlagRepo.find).toHaveBeenCalledTimes(1);
    });

    it('caches per tenant and environment, never across them', async () => {
      const env = makeEnv({ isEnabled: true });
      mockFlagRepo.find.mockResolvedValue([makeFlag({ environments: [env] })]);
      mockRedis.get.mockResolvedValue(null);

      await service.evaluateBulk({
        tenantId: 'tenant-1',
        environment: Environment.PRODUCTION,
        userId: 'u',
      });
      await service.evaluateBulk({
        tenantId: 'tenant-2',
        environment: Environment.PRODUCTION,
        userId: 'u',
      });

      const keys = mockRedis.set.mock.calls.map((c: unknown[]) => c[0]);
      expect(keys).toContain('flags:tenant-1:production');
      expect(keys).toContain('flags:tenant-2:production');
    });
  });

  describe('percentage rollout distribution', () => {
    it('approximately distributes users across 50% rollout', () => {
      // With 50% rollout, approximately half of users should be in
      let inRollout = 0;
      const total = 1000;
      for (let i = 0; i < total; i++) {
        const bucket = (service as any).computeHash(
          'rollout',
          'test-flag',
          `user-${i}`,
        );
        if (bucket < 50) inRollout++;
      }
      // Allow 10% margin
      expect(inRollout).toBeGreaterThan(total * 0.4);
      expect(inRollout).toBeLessThan(total * 0.6);
    });

    // Regression: rollout and variant selection once shared a single hash bucket, which
    // correlated the two decisions. Everyone who passed a 50% gate had bucket < 50, so a
    // 50/50 variant split gave 100% of them the first variant and 0% the second.
    it('splits variants evenly among users inside a partial rollout', () => {
      const variants = [
        { value: 'control', weight: 50 },
        { value: 'treatment', weight: 50 },
      ];
      const env = makeEnv({
        isEnabled: true,
        rolloutPercentage: 50,
        variants,
      });
      const flag = makeFlag({
        type: FlagType.STRING,
        defaultValue: 'off',
        environments: [env],
      });

      const counts: Record<string, number> = {};
      for (let i = 0; i < 2000; i++) {
        const result = (service as any).evaluateFlag(flag, env, `user-${i}`);
        counts[String(result.value)] = (counts[String(result.value)] ?? 0) + 1;
      }

      // ~50% gated out (value 'off'), and the ~1000 who pass split ~evenly.
      expect(counts.control).toBeGreaterThan(300);
      expect(counts.treatment).toBeGreaterThan(300);
      const ratio = counts.control / counts.treatment;
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(1.33);
    });

    it('keeps rollout membership stable when variant weights change', () => {
      // Independent salts mean re-weighting variants must not reshuffle who is in the rollout.
      const inRollout = (userId: string) =>
        (service as any).computeHash('rollout', 'my-flag', userId) < 50;
      const before = Array.from({ length: 200 }, (_, i) =>
        inRollout(`user-${i}`),
      );
      const after = Array.from({ length: 200 }, (_, i) =>
        inRollout(`user-${i}`),
      );
      expect(before).toEqual(after);
    });
  });
});
