import type { PostView, PublicationAction, PublicationView } from '@sp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking } from 'react-native';
import type { IconName } from '@/components/ui/button';
import { Banner, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { ConfirmActionSheet } from '@/components/screens/post-detail-confirm-sheet';
import { PostDetailHeader } from '@/components/screens/post-detail-header';
import { PublicationTimeline, type ActionMeta } from '@/components/screens/post-detail-timeline';
import { api, ApiError } from '@/lib/api';

const TERMINAL = ['PUBLISHED', 'FAILED_FINAL', 'CANCELLED'];

const STEP_LABELS: Record<string, string> = {
  UPLOAD: 'Uploading video',
  PROCESSING: 'Platform is processing',
  PUBLISH: 'Publishing',
  INIT_SESSION: 'Starting upload',
  UPLOAD_BYTES: 'Uploading to YouTube',
  WAIT_PROCESSING: 'YouTube is processing',
  CHECK_LIMIT: 'Checking limits',
  CREATE_CONTAINER: 'Sending to Instagram',
  WAIT_CONTAINER: 'Instagram is processing',
  PUBLISH_CONTAINER: 'Publishing',
  FETCH_PERMALINK: 'Getting link',
  START_UPLOAD: 'Starting upload',
  TRANSFER: 'Sending to Facebook',
  WAIT_UPLOAD: 'Facebook is receiving',
  FINISH: 'Publishing',
  WAIT_PUBLISH: 'Facebook is processing',
};

const ACTION_META: Record<PublicationAction, ActionMeta> = {
  RETRY: { label: 'Retry', icon: 'refresh', variant: 'filled' },
  CANCEL: { label: 'Cancel', icon: 'close', variant: 'text' },
  RECONNECT: { label: 'Reconnect', icon: 'link-variant', variant: 'filled' },
  MARK_PUBLISHED: { label: "It's posted", icon: 'check', variant: 'tonal' },
  PUBLISH_AGAIN: { label: 'Publish again', icon: 'send', variant: 'outlined' },
  OPEN: { label: 'Open', icon: 'open-in-new', variant: 'tonal' },
};

/** Actions that need confirmation before they run; OPEN and RECONNECT stay direct. */
const CONFIRM_ACTIONS: PublicationAction[] = ['RETRY', 'CANCEL', 'MARK_PUBLISHED', 'PUBLISH_AGAIN'];

interface ConfirmSpec {
  title: string;
  description?: string;
  confirmLabel: string;
  confirmIcon: IconName;
  confirmVariant: 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';
}

function confirmSpecFor(pub: PublicationView, action: PublicationAction): ConfirmSpec {
  switch (action) {
    case 'RETRY':
      return { title: `Retry on ${pub.platformName}?`, confirmLabel: 'Retry', confirmIcon: 'refresh', confirmVariant: 'filled' };
    case 'CANCEL':
      return { title: `Cancel ${pub.platformName}?`, description: 'This video will not be published there.', confirmLabel: 'Cancel publishing', confirmIcon: 'close', confirmVariant: 'danger' };
    case 'MARK_PUBLISHED':
      return {
        title: `Confirm it's on ${pub.platformName}`,
        description: 'Mark this as published because you can see it on your profile.',
        confirmLabel: "Yes, it's posted",
        confirmIcon: 'check',
        confirmVariant: 'tonal',
      };
    case 'PUBLISH_AGAIN':
      return {
        title: 'Publish again?',
        description: `Only do this if you checked ${pub.platformName} and the video is not there. Otherwise it may appear twice.`,
        confirmLabel: 'Publish again',
        confirmIcon: 'send',
        confirmVariant: 'outlined',
      };
    default:
      return { title: 'Confirm', confirmLabel: 'Confirm', confirmIcon: 'check', confirmVariant: 'filled' };
  }
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ pub: PublicationView; action: PublicationAction } | null>(null);

  const query = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.post(id),
    refetchInterval: (q) => {
      const post = q.state.data as PostView | undefined;
      return post && post.publications.every((p) => TERMINAL.includes(p.status) || p.status === 'NEEDS_USER_ACTION') ? false : 3000;
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ pub, action }: { pub: PublicationView; action: PublicationAction }) => {
      switch (action) {
        case 'RETRY':
          return api.retryPublication(pub.id);
        case 'CANCEL':
          return api.cancelPublication(pub.id);
        case 'MARK_PUBLISHED':
          return api.resolvePublication(pub.id, { outcome: 'PUBLISHED' });
        case 'PUBLISH_AGAIN':
          return api.resolvePublication(pub.id, { outcome: 'NOT_PUBLISHED' });
        default:
          return undefined;
      }
    },
    onSuccess: (post) => {
      if (post) qc.setQueryData(['post', id], post);
      void qc.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (e) => Alert.alert('Action failed', e instanceof ApiError ? e.message : 'Please try again.'),
  });

  const onAction = (pub: PublicationView, action: PublicationAction) => {
    if (action === 'OPEN' && pub.externalUrl) return void Linking.openURL(pub.externalUrl);
    if (action === 'RECONNECT') return router.push('/connections');
    if (CONFIRM_ACTIONS.includes(action)) {
      setConfirm({ pub, action });
      return;
    }
    mutation.mutate({ pub, action });
  };

  const confirmNow = () => {
    if (!confirm) return;
    mutation.mutate(confirm);
    setConfirm(null);
  };

  if (query.isLoading) return <Screen underHeader><LoadingState /></Screen>;
  if (query.error || !query.data) return <Screen underHeader><ErrorState message={(query.error as Error)?.message ?? 'Post not found.'} onRetry={query.refetch} /></Screen>;

  const post = query.data;
  const published = post.publications.filter((p) => p.status === 'PUBLISHED').length;
  const spec = confirm ? confirmSpecFor(confirm.pub, confirm.action) : null;
  const confirmRows = confirm
    ? [
        ...(confirm.pub.error?.message ? [{ label: 'Error', value: confirm.pub.error.message }] : []),
        { label: 'Attempts', value: String(confirm.pub.attemptCount) },
      ]
    : [];

  return (
    <Screen underHeader refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <PostDetailHeader status={post.status} title={post.title || post.caption?.split('\n')[0] || 'Untitled video'} caption={post.caption} createdAt={post.createdAt} published={published} total={post.publications.length} />

      {post.status === 'NEEDS_ATTENTION' ? <Banner tone="warning" message="One or more platforms need your attention. See the details below." /> : null}
      {post.status === 'PUBLISHED' ? <Banner tone="success" message="Your video is live on every selected platform." /> : null}

      <PublicationTimeline publications={post.publications} stepLabels={STEP_LABELS} actionMeta={ACTION_META} busy={mutation.isPending} onAction={onAction} />

      {confirm && spec ? (
        <ConfirmActionSheet
          open={Boolean(confirm)}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={spec.title}
          description={spec.description}
          rows={confirmRows}
          confirmLabel={spec.confirmLabel}
          confirmIcon={spec.confirmIcon}
          confirmVariant={spec.confirmVariant}
          loading={mutation.isPending}
          onConfirm={confirmNow}
        />
      ) : null}
    </Screen>
  );
}
