import 'reflect-metadata';
import 'dotenv/config';
import { ConsoleLogger, LogLevel, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

const LEVELS: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error'];

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new ConsoleLogger('SocialPublisher', {
    json: env.NODE_ENV === 'production',
    logLevels: LEVELS.slice(LEVELS.indexOf(env.LOG_LEVEL)),
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.useBodyParser('json', { limit: '1mb' });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.set('trust proxy', 1);
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'dev/oauth/:provider', method: RequestMethod.GET },
      { path: 'dev/fake-posts/:platform/:externalId', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();

  if (env.PROCESS_ROLE === 'worker') {
    await app.init();
    logger.log('Worker process running');
    return;
  }
  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`API listening on port ${env.PORT} (${env.API_BASE_URL}), role=${env.PROCESS_ROLE}, providers=${env.PROVIDER_MODE}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
