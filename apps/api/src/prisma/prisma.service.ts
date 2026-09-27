import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '../config/app-config';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.env.DATABASE_URL, max: 10 }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export type PrismaTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
