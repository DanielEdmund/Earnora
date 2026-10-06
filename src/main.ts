import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { assertSecureConfig, config } from './config';

async function main(): Promise<void> {
  // B1/B2: refuse production boot on dev secrets — before anything opens the DB
  assertSecureConfig();

  // rawBody: keep the exact webhook bytes for HMAC verification
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();
  app.enableCors({ origin: true, allowedHeaders: ['Authorization', 'Content-Type', 'x-pow-challenge', 'x-pow-nonce', 'x-device-fingerprint'] });
  const instance = app.getHttpAdapter().getInstance();
  instance.set?.('trust proxy', true); // honour X-Forwarded-For from the gateway only

  // proof screenshots - served openly (img tags cannot carry the Authorization
  // header); names are content-addressed SHA-256 so they are unguessable
  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(join(uploadsDir, 'proofs'), { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  await app.listen(config.port);
  console.log(`Earnora API listening on http://localhost:${config.port} (psp=${config.psp.mode}, window=${config.withdrawal.window} ${config.withdrawal.tz})`);
}

void main();
