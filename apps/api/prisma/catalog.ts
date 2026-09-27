// Seed catalog: platforms, features, publish limits/options, media rules and metrics.
// Values marked (verify) come from blueprint §15.4/§20–23 and must be checked against current provider docs.

export const FEATURES = [
  { code: 'connect', name: 'Connect accounts', scope: 'PLATFORM', enabled: true, description: 'Connect a social account' },
  { code: 'publish', name: 'Publishing', scope: 'PLATFORM', enabled: true, description: 'Publish videos' },
  { code: 'analytics', name: 'Analytics', scope: 'PLATFORM', enabled: true, description: 'Sync and view analytics' },
  { code: 'schedule', name: 'Scheduling', scope: 'PLATFORM', enabled: false, description: 'Schedule posts for later' },
  { code: 'music', name: 'Music', scope: 'PLATFORM', enabled: false, description: 'Add licensed music' },
  { code: 'multi_account', name: 'Multiple accounts', scope: 'PLATFORM', enabled: false, description: 'More than one account per platform' },
  { code: 'advanced_analytics', name: 'Advanced analytics', scope: 'PLATFORM', enabled: false, description: 'Deeper analytics' },
  { code: 'android_share', name: 'Share into the app', scope: 'GLOBAL', enabled: true, description: 'Android share target' },
  { code: 'admin', name: 'Owner console', scope: 'GLOBAL', enabled: true, description: 'Remote configuration' },
  { code: 'ai_caption', name: 'AI captions', scope: 'GLOBAL', enabled: false, description: 'Caption suggestions' },
  { code: 'auto_hashtag', name: 'Auto hashtags', scope: 'GLOBAL', enabled: false, description: 'Hashtag suggestions' },
  { code: 'download_report', name: 'Download reports', scope: 'GLOBAL', enabled: false, description: 'Export analytics' },
] as const;

export const ACCESS_LEVELS = [
  { code: 'OWNER', name: 'Owner', priority: 100 },
  { code: 'ADMIN', name: 'Admin', priority: 80 },
  { code: 'PRO', name: 'Pro', priority: 50 },
  { code: 'BASIC', name: 'Basic', priority: 20 },
  { code: 'READ_ONLY', name: 'Read only', priority: 10 },
] as const;

/** Features each access level allows on every platform (platform_id = null). */
export const ACCESS_DEFAULTS: Record<string, string[]> = {
  OWNER: FEATURES.map((f) => f.code),
  ADMIN: FEATURES.map((f) => f.code),
  PRO: ['connect', 'publish', 'analytics', 'schedule', 'music', 'multi_account', 'advanced_analytics', 'android_share', 'ai_caption', 'auto_hashtag', 'download_report'],
  BASIC: ['connect', 'publish', 'analytics', 'android_share'],
  READ_ONLY: ['analytics'],
};

const MB = 1024 ** 2;
const GB = 1024 ** 3;

export const PLATFORMS = [
  {
    code: 'youtube',
    name: 'YouTube',
    provider: 'GOOGLE',
    sortOrder: 10,
    config: { display: { color: '#FF0033', icon: 'youtube' } },
    publish: {
      limits: { titleRequired: true, titleMaxChars: 100, captionMaxChars: 5000 },
      options: [
        { key: 'privacyStatus', type: 'enum', label: 'Visibility', values: ['public', 'unlisted', 'private'], valueLabels: ['Public', 'Unlisted', 'Private'], default: 'private' },
        { key: 'madeForKids', type: 'boolean', label: 'Made for kids', default: false, required: true },
        { key: 'categoryId', type: 'enum', label: 'Category', values: ['22', '24', '10', '17', '20', '26', '27', '28'], valueLabels: ['People & Blogs', 'Entertainment', 'Music', 'Sports', 'Gaming', 'Howto & Style', 'Education', 'Science & Technology'], default: '22' },
      ],
      mediaRules: {
        containers: ['mov', 'mp4', 'matroska', 'webm'],
        videoCodecs: ['h264', 'hevc', 'vp9', 'av1', 'mpeg4'],
        audioCodecs: ['aac', 'opus', 'mp3', 'ac3', 'eac3', 'vorbis'],
        audioRequired: false,
        minDurationMs: 1000,
        maxDurationMs: 12 * 3600 * 1000,
        maxSizeBytes: 256 * GB,
        maxFps: 60,
        allowHdr: true,
        allowVariableFrameRate: true,
        allowTenBit: true,
      },
    },
  },
  {
    code: 'instagram',
    name: 'Instagram',
    provider: 'META',
    sortOrder: 20,
    config: { display: { color: '#E1306C', icon: 'instagram' } },
    publish: {
      limits: { titleRequired: false, captionMaxChars: 2200, maxHashtags: 30, maxDurationMs: 15 * 60 * 1000 },
      options: [
        { key: 'shareToFeed', type: 'boolean', label: 'Also show in feed', default: true },
        { key: 'coverFrameMs', type: 'integer', label: 'Cover frame (ms)', default: 0, min: 0 },
      ],
      mediaRules: {
        containers: ['mov', 'mp4'],
        videoCodecs: ['h264', 'hevc'],
        audioCodecs: ['aac'],
        audioRequired: false,
        minDurationMs: 3000,
        maxDurationMs: 15 * 60 * 1000,
        maxSizeBytes: 300 * MB,
        minFps: 23,
        maxFps: 60,
        maxWidth: 1920,
        aspectRatio: { min: 0.01, max: 10 },
        allowHdr: false,
        allowVariableFrameRate: false,
        allowTenBit: false,
      },
    },
  },
  {
    code: 'facebook',
    name: 'Facebook',
    provider: 'META',
    sortOrder: 30,
    config: { display: { color: '#1877F2', icon: 'facebook' } },
    publish: {
      limits: { titleRequired: false, captionMaxChars: 2200, maxDurationMs: 90 * 1000 },
      options: [],
      mediaRules: {
        containers: ['mov', 'mp4'],
        videoCodecs: ['h264'],
        audioCodecs: ['aac'],
        audioRequired: false,
        minDurationMs: 3000,
        maxDurationMs: 90 * 1000,
        maxSizeBytes: 1 * GB,
        minFps: 24,
        maxFps: 60,
        maxWidth: 1920,
        minWidth: 540,
        aspectRatio: { min: 0.5, max: 0.6 },
        allowHdr: false,
        allowVariableFrameRate: false,
        allowTenBit: false,
      },
    },
  },
] as const;

type MetricSeed = {
  key: string;
  platform: string | null;
  entity: 'ACCOUNT' | 'PUBLICATION';
  granularity: 'SNAPSHOT' | 'DAILY';
  displayName: string;
  aggregation: 'SUM' | 'LATEST' | 'AVERAGE';
  providerMetric: string | null;
  comparableGroup: string | null;
  unit?: string;
  isDerived?: boolean;
  description?: string;
};

export const METRICS: MetricSeed[] = [
  { key: 'youtube.account.subscribers_total', platform: 'youtube', entity: 'ACCOUNT', granularity: 'SNAPSHOT', displayName: 'Subscribers', aggregation: 'LATEST', providerMetric: 'statistics.subscriberCount', comparableGroup: 'audience_total', description: 'Rounded to 3 significant figures by YouTube' },
  { key: 'youtube.account.views_total', platform: 'youtube', entity: 'ACCOUNT', granularity: 'SNAPSHOT', displayName: 'Lifetime views', aggregation: 'LATEST', providerMetric: 'statistics.viewCount', comparableGroup: null },
  { key: 'youtube.account.views', platform: 'youtube', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Views', aggregation: 'SUM', providerMetric: 'views', comparableGroup: 'views' },
  { key: 'youtube.account.subscribers_gained', platform: 'youtube', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Subscribers gained', aggregation: 'SUM', providerMetric: 'subscribersGained', comparableGroup: null },
  { key: 'youtube.account.subscribers_lost', platform: 'youtube', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Subscribers lost', aggregation: 'SUM', providerMetric: 'subscribersLost', comparableGroup: null },
  { key: 'youtube.account.watch_minutes', platform: 'youtube', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Watch time', aggregation: 'SUM', providerMetric: 'estimatedMinutesWatched', comparableGroup: null, unit: 'minutes' },
  { key: 'youtube.account.likes', platform: 'youtube', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Likes', aggregation: 'SUM', providerMetric: 'likes', comparableGroup: 'likes' },
  { key: 'youtube.account.comments', platform: 'youtube', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Comments', aggregation: 'SUM', providerMetric: 'comments', comparableGroup: 'comments' },
  { key: 'youtube.account.shares', platform: 'youtube', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Shares', aggregation: 'SUM', providerMetric: 'shares', comparableGroup: 'shares' },
  { key: 'youtube.video.views', platform: 'youtube', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Views', aggregation: 'LATEST', providerMetric: 'statistics.viewCount', comparableGroup: 'views' },
  { key: 'youtube.video.likes', platform: 'youtube', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Likes', aggregation: 'LATEST', providerMetric: 'statistics.likeCount', comparableGroup: 'likes' },
  { key: 'youtube.video.comments', platform: 'youtube', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Comments', aggregation: 'LATEST', providerMetric: 'statistics.commentCount', comparableGroup: 'comments' },

  { key: 'instagram.account.followers_total', platform: 'instagram', entity: 'ACCOUNT', granularity: 'SNAPSHOT', displayName: 'Followers', aggregation: 'LATEST', providerMetric: 'followers_count', comparableGroup: 'audience_total' },
  { key: 'instagram.account.reach', platform: 'instagram', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Reach', aggregation: 'SUM', providerMetric: 'reach', comparableGroup: null },
  { key: 'instagram.account.views', platform: 'instagram', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Views', aggregation: 'SUM', providerMetric: 'views', comparableGroup: 'views' },
  { key: 'instagram.reel.views', platform: 'instagram', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Views', aggregation: 'LATEST', providerMetric: 'views', comparableGroup: 'views' },
  { key: 'instagram.reel.reach', platform: 'instagram', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Reach', aggregation: 'LATEST', providerMetric: 'reach', comparableGroup: null },
  { key: 'instagram.reel.likes', platform: 'instagram', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Likes', aggregation: 'LATEST', providerMetric: 'likes', comparableGroup: 'likes' },
  { key: 'instagram.reel.comments', platform: 'instagram', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Comments', aggregation: 'LATEST', providerMetric: 'comments', comparableGroup: 'comments' },
  { key: 'instagram.reel.shares', platform: 'instagram', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Shares', aggregation: 'LATEST', providerMetric: 'shares', comparableGroup: 'shares' },
  { key: 'instagram.reel.saves', platform: 'instagram', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Saves', aggregation: 'LATEST', providerMetric: 'saved', comparableGroup: null },

  { key: 'facebook.page.followers_total', platform: 'facebook', entity: 'ACCOUNT', granularity: 'SNAPSHOT', displayName: 'Followers', aggregation: 'LATEST', providerMetric: 'followers_count', comparableGroup: 'audience_total' },
  { key: 'facebook.page.views', platform: 'facebook', entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Views', aggregation: 'SUM', providerMetric: 'page_media_view', comparableGroup: 'views' },
  { key: 'facebook.reel.plays', platform: 'facebook', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Plays', aggregation: 'LATEST', providerMetric: 'blue_reels_play_count', comparableGroup: 'views' },
  { key: 'facebook.reel.reactions', platform: 'facebook', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Reactions', aggregation: 'LATEST', providerMetric: 'post_video_likes_by_reaction_type', comparableGroup: 'likes' },
  { key: 'facebook.reel.comments', platform: 'facebook', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Comments', aggregation: 'LATEST', providerMetric: 'comments', comparableGroup: 'comments' },
  { key: 'facebook.reel.shares', platform: 'facebook', entity: 'PUBLICATION', granularity: 'SNAPSHOT', displayName: 'Shares', aggregation: 'LATEST', providerMetric: 'shares', comparableGroup: 'shares' },

  { key: 'derived.audience.net_growth', platform: null, entity: 'ACCOUNT', granularity: 'DAILY', displayName: 'Net audience growth', aggregation: 'SUM', providerMetric: null, comparableGroup: null, isDerived: true, description: 'Computed from follower/subscriber totals' },
];
