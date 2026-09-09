import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { AppModule } from '../src/app.module';

/**
 * Dumps the live OpenAPI document to disk without listening on a port or
 * needing a reachable Postgres/Redis — `NestFactory.create` only instantiates
 * providers, and every `PrismaXService` in this codebase already tolerates a
 * missing DATABASE_URL_* at construction time (console.warn, not throw — see
 * each service's own header comment). `SwaggerModule.createDocument` builds the
 * document purely from decorator metadata, which is available before any
 * connection is ever opened.
 *
 * Used by `packages/api-client`'s own `generate` script (see that package's
 * README) to keep the typed SDK in sync with this API's actual current surface
 * — regenerate this whenever a module/endpoint is added, not just once.
 *
 * Mirrors main.ts's own DocumentBuilder config AND its `setGlobalPrefix('v1')`
 * call exactly — keep all three in sync if any change. Found on this script's
 * own first real run: `SwaggerModule.createDocument` does NOT retroactively
 * apply a prefix set after the document is built, and — less obviously — it
 * also won't reflect one set via a *different* app instance; omitting
 * `setGlobalPrefix` here produced a document with `/auth/login`-shaped paths
 * instead of the real, live `/v1/auth/login`, silently breaking every
 * frontend call site's path literal against the regenerated types.
 */
async function run() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('v1');
  const config = new DocumentBuilder()
    .setTitle('ULTM8 API')
    .setDescription('Modular REST API (Decision 70).')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const outPath = resolve(__dirname, '../../../packages/api-client/openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${Object.keys(document.paths ?? {}).length} paths to ${outPath}`);

  await app.close();
  process.exit(0);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('export-openapi failed:', err);
  process.exit(1);
});
