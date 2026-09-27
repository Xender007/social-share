import { Injectable, Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

export interface PushEvent {
  userId: string;
  title: string;
  body: string;
  /** Deep link path inside the app, e.g. /posts/123 */
  url: string;
  category: 'post.completed' | 'publication.needs_action' | 'connection.reauth_required' | 'connection.expiring' | 'publication.delayed';
}

/** Expo push notifications (§24). Payloads never contain tokens, signed URLs or raw provider errors. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly expo: Expo;
  /** Recent events, kept for local testing and the owner console. */
  readonly recent: Array<PushEvent & { at: string; delivered: number }> = [];

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfig,
  ) {
    this.expo = new Expo({ accessToken: config.env.EXPO_ACCESS_TOKEN });
  }

  async send(event: PushEvent): Promise<number> {
    const devices = await this.prisma.device.findMany({ where: { userId: event.userId } });
    const messages: ExpoPushMessage[] = devices
      .filter((d) => Expo.isExpoPushToken(d.expoPushToken))
      .map((d) => ({
        to: d.expoPushToken,
        title: event.title,
        body: event.body,
        sound: 'default',
        channelId: 'publishing',
        data: { url: event.url, category: event.category },
      }));

    let delivered = 0;
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, i) => {
          if (ticket.status === 'ok') delivered += 1;
          else if (ticket.details?.error === 'DeviceNotRegistered') {
            const token = (chunk[i]?.to as string) ?? '';
            void this.prisma.device.deleteMany({ where: { expoPushToken: token } });
          }
        });
      } catch (error) {
        this.logger.warn(`Push send failed: ${(error as Error).message}`);
      }
    }

    this.recent.unshift({ ...event, at: new Date().toISOString(), delivered });
    this.recent.splice(50);
    this.logger.log(`Notification "${event.title}" -> ${delivered}/${messages.length} devices`);
    return delivered;
  }
}
