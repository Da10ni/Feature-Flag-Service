import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { FeatureFlag, FlagType } from '../flags/entities/feature-flag.entity';
import {
  FlagEnvironment,
  Environment,
} from '../flags/entities/flag-environment.entity';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';

export interface EvaluationContext {
  tenantId: string;
  environment: Environment;
  userId: string;
  context?: Record<string, any>;
}

export interface EvaluationResult {
  flagKey: string;
  value: any;
  reason: string;
}

@Injectable()
export class EvaluationService {
  constructor(
    @InjectRepository(FeatureFlag) private flagRepo: Repository<FeatureFlag>,
    @InjectRepository(FlagEnvironment)
    private envRepo: Repository<FlagEnvironment>,
    private redisService: RedisService,
    private metrics: MetricsService,
  ) {}

  // Deterministic hash: maps salt+flagKey+userId to 0-99.
  private computeHash(salt: string, flagKey: string, userId: string): number {
    const hash = createHash('sha256')
      .update(`${salt}:${flagKey}:${userId}`)
      .digest('hex');
    const value = parseInt(hash.substring(0, 8), 16);
    return value % 100;
  }

  /**
   * Loads a tenant's active flag definitions for one environment, through Redis.
   *
   * The cache holds flag DEFINITIONS, not per-user evaluation results. Caching results
   * keyed by user gives a hit rate equal to how often the same user recurs — for a service
   * called once per end-user request that is close to zero, so nearly every request falls
   * through to a joined Postgres query and the cache earns nothing while still costing a
   * round trip. It also makes invalidation expensive: clearing one flag means scanning for
   * every user's key.
   *
   * Definitions are the opposite: a handful of rows per tenant, read constantly, changed
   * rarely. One entry serves every user, so the hit rate approaches 100% regardless of user
   * cardinality, and invalidation is a single DEL. Evaluation itself is then pure CPU — a
   * SHA-256 hash — which is microseconds and needs no cache at all.
   */
  private async loadFlags(
    tenantId: string,
    environment: Environment,
  ): Promise<FeatureFlag[]> {
    const cacheKey = `flags:${tenantId}:${environment}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      this.metrics.recordCache(true);
      return JSON.parse(cached) as FeatureFlag[];
    }
    this.metrics.recordCache(false);

    const flags = await this.flagRepo.find({
      where: { tenantId, isArchived: false },
      relations: { environments: true },
    });

    // Keep only the environment being evaluated: it is the only one this key serves, and
    // it keeps the cached payload small.
    const scoped = flags.map((flag) => ({
      ...flag,
      environments: flag.environments.filter(
        (e) => e.environment === environment,
      ),
    })) as FeatureFlag[];

    // Short TTL as a backstop only — writes invalidate explicitly (see FlagsService), so
    // this bounds staleness if an invalidation is ever lost rather than being the primary
    // freshness mechanism.
    await this.redisService.set(cacheKey, JSON.stringify(scoped), 60);
    return scoped;
  }

  async evaluate(
    ctx: EvaluationContext,
    flagKey: string,
  ): Promise<EvaluationResult> {
    const start = process.hrtime.bigint();
    const flags = await this.loadFlags(ctx.tenantId, ctx.environment);
    const flag = flags.find((f) => f.flagKey === flagKey);

    if (!flag) throw new NotFoundException(`Flag '${flagKey}' not found`);

    const result = this.evaluateFlag(flag, flag.environments[0], ctx.userId);
    this.metrics.recordEvaluation(ctx.tenantId, flag.type, this.elapsed(start));
    return result;
  }

  private elapsed(start: bigint): number {
    return Number(process.hrtime.bigint() - start) / 1e9;
  }

  async evaluateBulk(ctx: EvaluationContext): Promise<EvaluationResult[]> {
    // One cache read for the whole set, then N in-memory evaluations — no per-flag I/O.
    const flags = await this.loadFlags(ctx.tenantId, ctx.environment);

    return flags.map((flag) => {
      const start = process.hrtime.bigint();
      const result = this.evaluateFlag(flag, flag.environments[0], ctx.userId);
      this.metrics.recordEvaluation(
        ctx.tenantId,
        flag.type,
        this.elapsed(start),
      );
      return result;
    });
  }

  private evaluateFlag(
    flag: FeatureFlag,
    envConfig: FlagEnvironment | undefined,
    userId: string,
  ): EvaluationResult {
    if (!envConfig || !envConfig.isEnabled) {
      return {
        flagKey: flag.flagKey,
        value: flag.defaultValue,
        reason: 'FLAG_DISABLED',
      };
    }

    if (envConfig.rolloutPercentage < 100) {
      const bucket = this.computeHash('rollout', flag.flagKey, userId);
      if (bucket >= envConfig.rolloutPercentage) {
        return {
          flagKey: flag.flagKey,
          value: flag.defaultValue,
          reason: 'NOT_IN_ROLLOUT',
        };
      }
    }

    if (
      flag.type === FlagType.STRING &&
      envConfig.variants &&
      envConfig.variants.length > 0
    ) {
      const bucket = this.computeHash('variant', flag.flagKey, userId);
      let cumulative = 0;
      for (const variant of envConfig.variants) {
        cumulative += variant.weight;
        if (bucket < cumulative) {
          return {
            flagKey: flag.flagKey,
            value: variant.value,
            reason: 'VARIANT_MATCH',
          };
        }
      }
    }

    return {
      flagKey: flag.flagKey,
      value: flag.type === FlagType.BOOLEAN ? true : flag.defaultValue,
      reason: 'ENABLED',
    };
  }
}
