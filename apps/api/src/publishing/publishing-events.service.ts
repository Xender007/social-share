import { Injectable } from '@nestjs/common';
import { JobQueueService, QUEUES } from '../jobs/job-queue.service';
import type { PushEvent } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicationRow } from './publication.repository';

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Turns publishing state changes into user notifications, delivered by the notifications worker. */
@Injectable()
export class PublishingEvents {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobQueueService,
  ) {}

  private enqueue(event: PushEvent): Promise<string | null> {
    return this.jobs.send(QUEUES.notificationsSend, event);
  }

  async postCompleted(postId: string): Promise<void> {
    const post = await this.prisma.post.findUniqueOrThrow({
      where: { id: postId },
      include: { publications: { include: { platform: true } } },
    });
    const live = post.publications.filter((p) => p.status !== 'CANCELLED');
    const published = live.filter((p) => p.status === 'PUBLISHED').map((p) => p.platform.name);
    const failed = live.filter((p) => p.status !== 'PUBLISHED').map((p) => p.platform.name);
    const label = post.title?.trim() || post.caption?.split('\n')[0]?.slice(0, 60) || 'Your video';

    let title: string;
    let body: string;
    if (failed.length === 0) {
      title = `Published to ${joinNames(published)}`;
      body = label;
    } else if (published.length > 0) {
      title = `Published to ${published.length} of ${live.length}`;
      body = `${joinNames(failed)} failed. Tap to retry.`;
    } else {
      title = "Couldn't publish your video";
      body = `${label}: tap to see what went wrong.`;
    }
    await this.enqueue({ userId: post.userId, title, body, url: `/posts/${post.id}`, category: 'post.completed' });
  }

  async publicationNeedsAction(pub: PublicationRow): Promise<void> {
    await this.enqueue({
      userId: pub.post.userId,
      title: `${pub.platform.name} needs attention`,
      body: pub.errorMessage ?? 'Tap to review this publication.',
      url: `/posts/${pub.postId}`,
      category: 'publication.needs_action',
    });
  }

  async publicationDelayed(pub: PublicationRow, until: Date): Promise<void> {
    const time = until.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    await this.enqueue({
      userId: pub.post.userId,
      title: `${pub.platform.name} upload delayed`,
      body: `We'll try again around ${time}.`,
      url: `/posts/${pub.postId}`,
      category: 'publication.delayed',
    });
  }

  async connectionNeedsReauth(userId: string, providerLabel: string): Promise<void> {
    await this.enqueue({
      userId,
      title: `Reconnect ${providerLabel}`,
      body: `Your ${providerLabel} connection expired. Reconnect to keep publishing.`,
      url: '/connections',
      category: 'connection.reauth_required',
    });
  }
}
