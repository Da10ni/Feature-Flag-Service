import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { JsonLogger } from './common/logger/json.logger';
import { runMigrations } from './database/run-migrations';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new JsonLogger();
  app.useLogger(logger);

  // synchronize is off everywhere, so the schema only exists if migrations run. Doing it
  // at boot rather than in a separate job keeps a deploy to a single artifact; the advisory
  // lock inside runMigrations makes it safe when Cloud Run starts several instances at once.
  await runMigrations(app.get(DataSource));

  // Surface a missing admin key at deploy time. AdminKeyGuard already refuses tenant
  // registration in production without it, but that would otherwise only be discovered
  // whenever someone next tried to register.
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_API_KEY) {
    logger.error(
      'ADMIN_API_KEY is not set: tenant registration will return 503. Check the Secret Manager binding.',
      undefined,
      'Bootstrap',
    );
  }

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  // Registered after the global prefix so the documented paths match the real ones.
  // Served in every environment: an API whose docs are only available on someone's laptop
  // is an API nobody can integrate against.
  setupSwagger(app);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(
    JSON.stringify({
      level: 'info',
      message: `App listening on port ${port}`,
      timestamp: new Date().toISOString(),
    }),
  );
}
bootstrap();
