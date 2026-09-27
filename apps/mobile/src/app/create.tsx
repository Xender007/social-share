import type { CapabilityPlatformView, CreatePostRequest, PublishOptionField } from '@sp/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Button } from '@/components/ui/button';
import { Banner, LoadingState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { CaptionStep } from '@/components/screens/create-caption-step';
import { PlatformsStep, type Destination } from '@/components/screens/create-platforms-step';
import { PreviewSection } from '@/components/screens/create-preview-section';
import { ReviewPublishSheet } from '@/components/screens/create-review-sheet';
import { StepHeader } from '@/components/screens/create-step-header';
import { VideoPickerTile, VideoStep } from '@/components/screens/create-video-step';
import { useCapabilities } from '@/hooks/use-capabilities';
import { api, ApiError } from '@/lib/api';
import { askForPushAfterPublish } from '@/lib/push';
import { uploadVideo } from '@/lib/upload';
import { useDraft } from '@/stores/draft';

const formatDuration = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '');
const formatSize = (bytes: number | null) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '');
const formatResolution = (width: number | null, height: number | null) => (width && height ? `${width}×${height}` : null);

function defaultOptions(fields: PublishOptionField[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));
}

/** Fades a section in on mount; a no-op under reduced motion (final state shown immediately). */
function FadeSection({ index, children }: { index: number; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) return <View>{children}</View>;
  return <Animated.View entering={FadeInDown.duration(280).delay(Math.min(index, 4) * 60).withInitialValues({ transform: [{ translateY: 10 }] })}>{children}</Animated.View>;
}

export default function CreatePostScreen() {
  const qc = useQueryClient();
  const { caps, isLoading } = useCapabilities();
  const draft = useDraft();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; perAccount?: Record<string, string> } | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);

  const targets = useMemo(() => (caps?.platforms ?? []).filter((p) => p.capabilities.publish), [caps]);
  const destinations: Destination[] = targets.flatMap((platform) => platform.connection.accounts.filter((a) => a.status === 'ACTIVE').map((account) => ({ platform, account })));
  const selected = destinations.filter((d) => draft.destinations[d.account.id]?.selected);

  const media = useQuery({
    queryKey: ['media', draft.upload.media?.id],
    queryFn: () => api.media(draft.upload.media!.id),
    enabled: Boolean(draft.upload.media?.id) && draft.upload.status === 'processing',
    refetchInterval: 2000,
  });

  useEffect(() => {
    const m = media.data;
    if (!m || draft.upload.status !== 'processing') return;
    if (m.status === 'READY') draft.setUpload({ status: 'ready', media: m });
    if (m.status === 'INVALID') draft.setUpload({ status: 'error', media: m, error: "This video couldn't be read. Try exporting it again." });
  }, [media.data, draft]);

  const startUpload = useCallback(async () => {
    const video = useDraft.getState().video;
    if (!video) return;
    const controller = new AbortController();
    uploadAbort.current = controller;
    draft.setUpload({ status: 'uploading', error: null });
    await activateKeepAwakeAsync('upload');
    try {
      const result = await uploadVideo(
        video,
        {
          onProgress: (progress) => useDraft.getState().setUpload({ progress }),
          onCheckpoint: (checkpoint) => useDraft.getState().setUpload({ checkpoint }),
        },
        useDraft.getState().upload.checkpoint,
        controller.signal,
      );
      useDraft.getState().setUpload({ status: result.status === 'READY' ? 'ready' : 'processing', media: result, progress: 1, checkpoint: null });
    } catch (e) {
      if (!controller.signal.aborted) useDraft.getState().setUpload({ status: 'error', error: e instanceof ApiError ? e.message : 'Upload failed. Check your connection and try again.' });
    } finally {
      deactivateKeepAwake('upload');
    }
  }, [draft]);

  useEffect(() => {
    if (draft.video && draft.upload.status === 'idle') void startUpload();
  }, [draft.video, draft.upload.status, startUpload]);

  useEffect(() => () => uploadAbort.current?.abort(), []);

  // Preselect every available destination for a fresh draft, with platform defaults.
  useEffect(() => {
    if (!caps) return;
    for (const { platform, account } of destinations) {
      if (!draft.destinations[account.id]) draft.setDestination(account.id, { selected: true, options: defaultOptions(platform.publish.options) });
    }
  }, [caps]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1, allowsMultipleSelection: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    uploadAbort.current?.abort();
    draft.setVideo({
      uri: asset.uri,
      fileName: asset.fileName ?? `video-${Date.now()}.mp4`,
      mimeType: asset.mimeType ?? 'video/mp4',
      size: asset.fileSize ?? null,
      durationMs: asset.duration ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
    });
  };

  const discard = () =>
    Alert.alert('Discard this post?', 'The video and text will be removed from this draft.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          uploadAbort.current?.abort();
          draft.reset();
          router.back();
        },
      },
    ]);

  const durationIssue = (platform: CapabilityPlatformView) => {
    const max = platform.publish.limits.maxDurationMs;
    const duration = draft.upload.media?.durationMs ?? draft.video?.durationMs ?? null;
    return max && duration && duration > max ? `Too long for ${platform.name} (max ${formatDuration(max)})` : null;
  };

  const titleNeeded = selected.some((d) => d.platform.publish.limits.titleRequired);
  const titleMax = Math.min(...selected.map((d) => d.platform.publish.limits.titleMaxChars ?? 500), 500);
  const captionMax = Math.min(...selected.map((d) => d.platform.publish.limits.captionMaxChars), 10000);
  const effectiveTitle = draft.title.trim() || draft.caption.split('\n')[0]?.trim();
  const textProblem =
    titleNeeded && !effectiveTitle ? 'Add a title for YouTube.' : draft.title.length > titleMax ? `Title is too long (max ${titleMax}).` : draft.caption.length > captionMax ? `Caption is too long (max ${captionMax}).` : null;
  const blockedSelection = selected.find((d) => durationIssue(d.platform));
  const canPublish = draft.upload.status === 'ready' && selected.length > 0 && !textProblem && !blockedSelection && !submitting;

  const publish = async () => {
    if (!draft.upload.media) return;
    setSubmitting(true);
    setSubmitError(null);
    const body: CreatePostRequest = {
      mediaId: draft.upload.media.id,
      title: draft.title.trim() || undefined,
      caption: draft.caption || undefined,
      destinations: selected.map(({ account }) => {
        const d = draft.destinations[account.id]!;
        return { socialAccountId: account.id, titleOverride: d.titleOverride || undefined, captionOverride: d.captionOverride || undefined, options: d.options };
      }),
    };
    try {
      const post = await api.createPost(body, draft.idempotencyKey);
      void qc.invalidateQueries({ queryKey: ['posts'] });
      draft.reset();
      router.replace(`/posts/${post.id}`);
      void askForPushAfterPublish();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MEDIA_INCOMPATIBLE' && Array.isArray(e.details)) {
        const perAccount = Object.fromEntries((e.details as Array<{ socialAccountId: string; issues: Array<{ message: string }> }>).map((d) => [d.socialAccountId, d.issues.map((i) => i.message).join(' ')]));
        setSubmitError({ message: e.message, perAccount });
      } else {
        setSubmitError({ message: e instanceof ApiError ? e.message : 'Could not publish. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !caps) return <Screen underHeader><LoadingState /></Screen>;

  const uploadLabel =
    draft.upload.status === 'uploading'
      ? `Uploading ${Math.round(draft.upload.progress * 100)}% · keep the app open`
      : draft.upload.status === 'processing'
        ? 'Checking video…'
        : draft.upload.status === 'ready'
          ? 'Uploaded'
          : draft.upload.status === 'error'
            ? 'Upload failed'
            : 'Waiting to upload';

  const unconnected = targets.filter((p) => !p.connection.accounts.some((a) => a.status === 'ACTIVE'));

  return (
    <>
      <Stack.Screen options={{ headerRight: () => (draft.video ? <Button label="Discard" variant="text" onPress={discard} /> : null) }} />
      <Screen
        underHeader
        footer={
          draft.video ? (
            <Button testID="create-review" label="Review & publish" icon="arrow-right-circle" onPress={() => setReviewOpen(true)} disabled={submitting} fullWidth />
          ) : null
        }>
        {!draft.video ? (
          <FadeSection index={0}>
            <VideoPickerTile onPick={pickVideo} />
          </FadeSection>
        ) : (
          <>
            <FadeSection index={0}>
              <View style={styles.stepBlock}>
                <StepHeader step={1} title="Video" />
                <VideoStep
                  video={draft.video}
                  durationLabel={formatDuration(draft.upload.media?.durationMs ?? draft.video.durationMs)}
                  sizeLabel={formatSize(draft.upload.media?.sizeBytes ?? draft.video.size)}
                  isHdr={Boolean(draft.upload.media?.isHdr)}
                  resolutionLabel={formatResolution(draft.upload.media?.width ?? draft.video.width, draft.upload.media?.height ?? draft.video.height)}
                  uploadStatus={draft.upload.status}
                  uploadProgress={draft.upload.progress}
                  uploadLabel={uploadLabel}
                  onChangeVideo={pickVideo}
                  onRetryUpload={() => draft.setUpload({ status: 'idle' })}
                />
              </View>
            </FadeSection>

            <FadeSection index={1}>
              <View style={styles.stepBlock}>
                <StepHeader step={2} title="Caption" />
                <CaptionStep title={draft.title} setTitle={draft.setTitle} caption={draft.caption} setCaption={draft.setCaption} titleNeeded={titleNeeded} titleMax={titleMax} captionMax={captionMax} />
              </View>
            </FadeSection>

            {submitError ? <Banner tone="error" message={submitError.message} /> : textProblem && draft.upload.status === 'ready' ? <Banner tone="warning" message={textProblem} /> : null}

            <FadeSection index={2}>
              <View style={styles.stepBlock}>
                <StepHeader step={3} title="Platforms" />
                <PlatformsStep
                  destinations={destinations}
                  drafts={draft.destinations}
                  unconnected={unconnected}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  onToggleSelected={(accountId) => draft.setDestination(accountId, { selected: !draft.destinations[accountId]?.selected })}
                  onOptionChange={(accountId, field, value) => draft.setDestination(accountId, { options: { [field.key]: value } })}
                  onOverrideChange={(accountId, patch) => draft.setDestination(accountId, patch)}
                  durationIssue={durationIssue}
                  perAccountError={submitError?.perAccount}
                  noTargets={targets.length === 0}
                />
              </View>
            </FadeSection>

            {selected.length > 0 ? (
              <FadeSection index={3}>
                <View style={styles.stepBlock}>
                  <StepHeader step={4} title="Preview on each platform" />
                  <PreviewSection selected={selected} drafts={draft.destinations} videoUri={draft.video.uri} caption={draft.caption} title={effectiveTitle} />
                </View>
              </FadeSection>
            ) : null}
          </>
        )}
      </Screen>

      {draft.video ? (
        <ReviewPublishSheet
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          selected={selected}
          drafts={draft.destinations}
          video={draft.video}
          videoDurationLabel={formatDuration(draft.upload.media?.durationMs ?? draft.video.durationMs)}
          videoResolutionLabel={formatResolution(draft.upload.media?.width ?? draft.video.width, draft.upload.media?.height ?? draft.video.height)}
          title={draft.title}
          caption={draft.caption}
          problem={textProblem}
          submitError={submitError?.message ?? null}
          submitting={submitting}
          canPublish={canPublish}
          onPublish={publish}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  stepBlock: { gap: 12 },
});
