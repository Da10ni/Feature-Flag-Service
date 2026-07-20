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
    // quit() rejects with "Connection is closed." when the client is still connecting or
    // has already gone down — which is exactly the case for a short-lived process that
    // never issued a command. Unguarded, that rejection propagates out of app.close() and
    // fails shutdown, which is how it surfaced: an e2e suite that touches no Redis at all
    // failing during teardown.
    //
    // Shutdown is also the one path where a Redis error genuinely does not matter, and the
    // rest of this class already treats Redis as fail-open.
    try {
      await this.client.quit();
    } catch {
      // Force the socket down so the process is not held open by a half-open connection.
      this.client.disconnect();
    }
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
