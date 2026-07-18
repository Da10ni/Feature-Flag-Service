import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
      // enableOfflineQueue queues the first commands until the connection is ready,
      // so the first cache write after cold start isn't silently dropped.
      enableOfflineQueue: true,
      maxRetriesPerRequest: 2,
    });
    this.client.on('error', (err) => {
      process.stderr.write(
        JSON.stringify({
          level: 'warn',
          message: 'Redis error',
          error: err.message,
        }) + '\n',
      );
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds = 60): Promise<void> {
    try {
      await this.client.setex(key, ttlSeconds, value);
    } catch {
      /* ignore */
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      /* ignore */
    }
  }
}
