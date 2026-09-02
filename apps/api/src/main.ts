import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
