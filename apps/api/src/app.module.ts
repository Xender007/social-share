import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AdminController, AdminService } from './admin/admin.controller';
import { AnalyticsSyncService } from './analytics/analytics-sync.service';
import { AnalyticsController, AnalyticsQueryService } from './analytics/analytics.controller';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CapabilitiesController, CapabilitiesService } from './capabilities/capabilities.controller';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { RateLimitGuard } from './common/rate-limit.guard';
import { requestIdMiddleware } from './common/request-context';
import { ConfigModule } from './config/app-config';
import { AuthProviderRegistry } from './connections/auth-providers';
import { ConnectionsController, DevController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { CredentialsService } from './connections/credentials.service';
import { CryptoModule } from './crypto/token-cipher';
import { CapabilityGuard, EntitlementsModule } from './entitlements/entitlements.service';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/job-queue.service';
import { KillSwitchModule } from './kill-switches/kill-switch.service';
import { LegalController } from './legal/legal.controller';
import { MediaProcessingService } from './media-processing/media-processing.service';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { NotificationsService } from './notifications/notifications.service';
import { PostsController } from './posts/posts.controller';
import { PostsService } from './posts/posts.service';
import { PrismaModule } from './prisma/prisma.service';
import { AdapterRegistry } from './publishing/adapter-registry';
import { PublicationRunner } from './publishing/publication-runner.service';
import { PublicationRepository } from './publishing/publication.repository';
import { PublishContextFactory } from './publishing/publish-context.factory';
import { PublishingEvents } from './publishing/publishing-events.service';
import { SettingsModule } from './settings/settings.service';
import { StorageModule } from './storage/storage.service';
import { WorkerService } from './worker/worker.service';

@Module({
  imports: [ConfigModule, PrismaModule, CryptoModule, AuditModule, SettingsModule, StorageModule, JobsModule, EntitlementsModule, KillSwitchModule, AuthModule],
  controllers: [
    HealthController,
    LegalController,
    CapabilitiesController,
    ConnectionsController,
    DevController,
    MediaController,
    PostsController,
    AnalyticsController,
    AdminController,
  ],
  providers: [
    // Guard order matters: authenticate, then rate limit per user, then check capabilities.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useExisting: CapabilityGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    AuthProviderRegistry,
    CredentialsService,
    ConnectionsService,
    CapabilitiesService,
    NotificationsService,
    AdapterRegistry,
    PublicationRepository,
    PublishContextFactory,
    PublishingEvents,
    PublicationRunner,
    MediaService,
    MediaProcessingService,
    PostsService,
    AnalyticsSyncService,
    AnalyticsQueryService,
    AdminService,
    WorkerService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('{*path}');
  }
}
