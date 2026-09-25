import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './common/config';
import { PrismaService } from './common/prisma/prisma.service';
import { validationOptions } from './common/validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe(validationOptions));

  app.enableCors({
    origin: config.corsOrigins,
    // The browser must be allowed to send and read the idempotency headers.
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Idempotency-Replayed'],
  });

  app.get(PrismaService).enableShutdownHooks(app);
  app.enableShutdownHooks();

  await app.listen(config.port);
  console.log(`CareShield Max API listening on http://localhost:${config.port}`);
}

void bootstrap();
