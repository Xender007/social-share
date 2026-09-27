import type { CapabilityAccountView, CapabilityPlatformView } from '@sp/contracts';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/feedback';
import { Sheet, SheetClose, SheetContent, SheetDetailRows, SheetFooter } from '@/components/sheet';
import type { DestinationDraft, DraftVideo } from '@/stores/draft';

export interface ReviewPublishSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: Array<{ platform: CapabilityPlatformView; account: CapabilityAccountView }>;
  drafts: Record<string, DestinationDraft>;
  video: DraftVideo;
  videoDurationLabel: string;
  videoResolutionLabel: string | null;
  title: string;
  caption: string;
  problem: string | null;
  submitError: string | null;
  submitting: boolean;
  canPublish: boolean;
  onPublish: () => void;
}

function truncate(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

/** Confirms everything before publishing; runs the same publish handler the screen already had. */
export function ReviewPublishSheet({
  open,
  onOpenChange,
  selected,
  drafts,
  video,
  videoDurationLabel,
  videoResolutionLabel,
  title,
  caption,
  problem,
  submitError,
  submitting,
  canPublish,
  onPublish,
}: ReviewPublishSheetProps) {
  const platformNames = selected.map((d) => d.platform.name).join(', ') || 'None selected';
  const videoValue = [videoDurationLabel, videoResolutionLabel].filter(Boolean).join(' · ') || video.fileName;
  const captionValue = caption.trim() ? truncate(caption, 40) : title.trim() ? 'Using title' : 'Empty';
  const customized = selected.filter(({ account }) => {
    const d = drafts[account.id];
    return Boolean(d?.titleOverride?.trim() || d?.captionOverride?.trim());
  });

  const rows = [
    { label: 'Platforms', value: platformNames },
    { label: 'Video', value: videoValue },
    { label: 'Caption', value: captionValue },
    { label: 'Title', value: title.trim() || 'None' },
    ...(customized.length > 0 ? [{ label: 'Customized', value: customized.map((d) => d.platform.name).join(', ') }] : []),
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Review & publish" description="Check everything before it goes live.">
        <SheetDetailRows rows={rows} />
        {submitError ? <Banner tone="error" message={submitError} /> : problem ? <Banner tone="warning" message={problem} /> : null}
        <SheetFooter>
          <Button
            testID="create-publish"
            label={`Publish to ${selected.length} platform${selected.length === 1 ? '' : 's'}`}
            icon="send"
            onPress={onPublish}
            loading={submitting}
            disabled={!canPublish}
            fullWidth
          />
          <SheetClose asChild>
            <Button label="Keep editing" variant="text" fullWidth />
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
