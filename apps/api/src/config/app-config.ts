import { Global, Module } from '@nestjs/common';
import { Env, loadEnv } from './env';

export class AppConfig {
  constructor(readonly env: Env) {}

  get isFakeProviders(): boolean {
    return this.env.PROVIDER_MODE === 'fake';
  }

  get runsApi(): boolean {
    return this.env.PROCESS_ROLE !== 'worker';
  }

  get runsWorker(): boolean {
    return this.env.PROCESS_ROLE !== 'api' && this.env.JOBS_ENABLED;
  }

  get pgBossUrl(): string {
    return this.env.PGBOSS_DATABASE_URL ?? this.env.DATABASE_URL;
  }
}

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => new AppConfig(loadEnv()) }],
  exports: [AppConfig],
})
export class ConfigModule {}
