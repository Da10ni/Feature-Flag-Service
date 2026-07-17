import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { JsonLogger } from './common/logger/json.logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new JsonLogger());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(JSON.stringify({ level: 'info', message: `App listening on port ${port}`, timestamp: new Date().toISOString() }));
}
bootstrap();
