import { FacebookPreview, ReelsPreview, ShortsPreview } from '@/components/mockups/platform-previews';
import type { PhoneSlide } from '@/components/mockups/phone-carousel';
import { PhoneCarousel } from '@/components/mockups/phone-carousel';
import type { CapabilityAccountView, CapabilityPlatformView } from '@sp/contracts';
import type { DestinationDraft } from '@/stores/draft';

const PREVIEW_COMPONENTS = {
  youtube: ShortsPreview,
  instagram: ReelsPreview,
  facebook: FacebookPreview,
} as const;

const PREVIEW_LABELS: Record<string, string> = {
  youtube: 'YouTube Shorts',
  instagram: 'Instagram Reels',
  facebook: 'Facebook',
};

export interface PreviewSectionProps {
  selected: Array<{ platform: CapabilityPlatformView; account: CapabilityAccountView }>;
  drafts: Record<string, DestinationDraft>;
  videoUri: string;
  caption: string;
  title?: string;
}

/** PhoneCarousel of live platform previews, one per selected platform (deduped), using the picked video. */
export function PreviewSection({ selected, drafts, videoUri, caption, title }: PreviewSectionProps) {
  const seen = new Set<string>();
  const slides: PhoneSlide[] = [];

  for (const { platform, account } of selected) {
    const Component = PREVIEW_COMPONENTS[platform.code as keyof typeof PREVIEW_COMPONENTS];
    if (!Component || seen.has(platform.code)) continue;
    seen.add(platform.code);
    const d = drafts[account.id];
    const effectiveCaption = d?.captionOverride?.trim() || caption;
    const effectiveTitle = d?.titleOverride?.trim() || title;
    const accountName = account.handle ?? account.displayName;
    slides.push({
      key: platform.code,
      label: PREVIEW_LABELS[platform.code] ?? platform.name,
      render: (ctx) => <Component videoUri={videoUri} caption={effectiveCaption} title={effectiveTitle} accountName={accountName} active={ctx.active} width={ctx.width} />,
    });
  }

  if (slides.length === 0) return null;

  return <PhoneCarousel slides={slides} accessibilityLabel="Preview on each platform" />;
}
