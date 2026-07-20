/**
 * Writes the OpenAPI document to openapi.json.
 *
 * The spec is generated from the live Nest application rather than hand-written, so it
 * cannot describe a route that does not exist or omit one that does. Run it after changing
 * any controller or DTO:
 *
 *     npm run openapi:generate
 *
 * Requires the database to be reachable (`docker compose up -d postgres redis`), because
 * building the document means instantiating the real application module.
 */
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/swagger';

async function generate(): Promise<void> {
  // logger: false keeps the generated-file output readable; the app is never listened on.
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
