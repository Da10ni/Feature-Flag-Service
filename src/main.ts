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

  await runMigrations(app.get(DataSource));

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
