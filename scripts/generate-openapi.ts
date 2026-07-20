import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/swagger';

async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();

  const document = buildOpenApiDocument(app);
  const outputPath = join(process.cwd(), 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');

  const pathCount = Object.keys(document.paths).length;
  const opCount = Object.values(document.paths).reduce(
    (n, item) =>
      n +
      Object.keys(item).filter((k) =>
        ['get', 'post', 'put', 'patch', 'delete'].includes(k),
      ).length,
    0,
  );
  const schemaCount = Object.keys(document.components?.schemas ?? {}).length;

  process.stdout.write(
    `openapi.json written — ${pathCount} paths, ${opCount} operations, ${schemaCount} schemas\n`,
  );

  await app.close();
}

generate().catch((err) => {
  process.stderr.write(`Failed to generate OpenAPI document: ${String(err)}\n`);
  process.exit(1);
});
