import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { FeatureFlag, FlagType } from '../flags/entities/feature-flag.entity';
import { FlagEnvironment } from '../flags/entities/flag-environment.entity';
import { RedisService } from '../redis/redis.service';

export interface EvaluationContext {
  tenantId: string;
  environment: string;
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
    @InjectRepository(FlagEnvironment) private envRepo: Repository<FlagEnvironment>,
    private redisService: RedisService,
  ) {}

  // Deterministic hash: maps flagKey+userId to 0-99
  private computeHash(flagKey: string, userId: string): number {
    const hash = createHash('sha256').update(`${flagKey}:${userId}`).digest('hex');
    const value = parseInt(hash.substring(0, 8), 16);
    return value % 100;
  }

  async evaluate(ctx: EvaluationContext, flagKey: string): Promise<EvaluationResult> {
    const cacheKey = `eval:${ctx.tenantId}:${ctx.environment}:${flagKey}:${ctx.userId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) return { ...JSON.parse(cached), reason: 'CACHED' };

    const flag = await this.flagRepo.findOne({
      where: { tenantId: ctx.tenantId, flagKey, isArchived: false },
      relations: ['environments'],
    });

    if (!flag) throw new NotFoundException(`Flag '${flagKey}' not found`);

    const envConfig = flag.environments.find(e => e.environment === ctx.environment);
    const result = this.evaluateFlag(flag, envConfig, ctx.userId);

    await this.redisService.set(cacheKey, JSON.stringify(result), 30);
    return result;
  }

  async evaluateBulk(ctx: EvaluationContext): Promise<EvaluationResult[]> {
    const flags = await this.flagRepo.find({
      where: { tenantId: ctx.tenantId, isArchived: false },
      relations: ['environments'],
    });

    return Promise.all(flags.map(async flag => {
      const cacheKey = `eval:${ctx.tenantId}:${ctx.environment}:${flag.flagKey}:${ctx.userId}`;
      const cached = await this.redisService.get(cacheKey);
      if (cached) return { ...JSON.parse(cached), reason: 'CACHED' };

      const envConfig = flag.environments.find(e => e.environment === ctx.environment);
      const result = this.evaluateFlag(flag, envConfig, ctx.userId);
      await this.redisService.set(cacheKey, JSON.stringify(result), 30);
      return result;
    }));
  }

  private evaluateFlag(flag: FeatureFlag, envConfig: FlagEnvironment | undefined, userId: string): EvaluationResult {
    if (!envConfig || !envConfig.isEnabled) {
      return { flagKey: flag.flagKey, value: flag.defaultValue, reason: 'FLAG_DISABLED' };
    }

    if (envConfig.rolloutPercentage < 100) {
      const bucket = this.computeHash(flag.flagKey, userId);
      if (bucket >= envConfig.rolloutPercentage) {
        return { flagKey: flag.flagKey, value: flag.defaultValue, reason: 'NOT_IN_ROLLOUT' };
      }
    }

    if (flag.type === FlagType.STRING && envConfig.variants && envConfig.variants.length > 0) {
      const bucket = this.computeHash(flag.flagKey, userId);
      let cumulative = 0;
      for (const variant of envConfig.variants) {
        cumulative += variant.weight;
        if (bucket < cumulative) {
          return { flagKey: flag.flagKey, value: variant.value, reason: 'VARIANT_MATCH' };
        }
      }
    }

    return { flagKey: flag.flagKey, value: flag.type === FlagType.BOOLEAN ? true : flag.defaultValue, reason: 'ENABLED' };
  }
}
