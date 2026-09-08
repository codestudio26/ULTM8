import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // rawBody: true (Phase 8) — Stripe webhook signature verification
  // (stripe.webhooks.constructEvent, Section 10.2) needs the exact, unparsed request
  // body bytes; verification fails against a re-serialized JSON object, since
  // whitespace/key-order can differ from what Stripe actually signed. Nest's own
  // supported mechanism for this populates req.rawBody alongside the normal parsed
  // body for every route — it doesn't disable JSON parsing anywhere else, only adds
  // the raw buffer PaymentsController's webhook handler reads via @Req().
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // CORS — apps/school-portal (and any other browser client) calls this API
  // cross-origin, and without this, a real browser blocks every request starting
  // with the first login attempt (confirmed missing in a full-codebase review;
  // nothing in tsc/build/the existing supertest-based e2e suite can catch this,
  // since none of them make an actual cross-origin request through a real
  // browser). Origin allowlist comes from CORS_ALLOWED_ORIGINS (comma-separated),
  // defaulting to the school-portal dev server if unset — same "sensible default
  // if unset" pattern as PORT below. Deliberately fails safe: if this env var is
  // ever forgotten in a real deployment, production is loudly, obviously broken
  // (every request blocked) rather than silently permissive.
  //
  // credentials is deliberately NOT enabled — this API is Bearer-token auth via
  // the Authorization header (packages/api-client's authMiddleware attaches it
  // manually), not cookies; openapi-fetch's underlying fetch() defaults to
  // credentials: 'same-origin', so no credential is sent cross-origin regardless.
  // Credentialed CORS is a Tier 2 concern tied to the deferred httpOnly-cookie
  // refresh-token design (ultm8-nestjs-module §7) — revisit together, not now (a
  // permissive origin list can't legally combine with credentials per spec).
  //
  // methods/headers are left on the `cors` package's defaults (it reflects
  // whatever the browser's preflight actually requests) rather than a
  // hand-maintained list that can drift as endpoints get added.
  const corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
    : ['http://localhost:5173'];
  app.enableCors({ origin: corsAllowedOrigins });

  // /v1 URI prefix from the first deploy (Decision 22, ultm8-nestjs-module §2).
  app.setGlobalPrefix('v1');

  // class-validator DTO validation on every endpoint — the platform's
  // injection-protection baseline (Spec §11.5, ultm8-nestjs-module §3).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Standardized {error:{code,message}} envelope on every non-2xx response
  // (Decision 22, ultm8-nestjs-module §2).
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger/OpenAPI is the API contract (Spec §1.2, ultm8-nestjs-module §3).
  const config = new DocumentBuilder()
    .setTitle('ULTM8 API')
    .setDescription('Modular REST API (Decision 70). Walking-skeleton build — Phase 1.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('v1/docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ULTM8 API listening on :${port} (prefix /v1, docs at /v1/docs)`);
}

bootstrap();
