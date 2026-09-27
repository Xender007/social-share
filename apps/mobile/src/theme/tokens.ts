/**
 * Design tokens. Source: design-system/social-publisher/BROADCAST.md ("Broadcast" identity).
 * Gradient violet -> magenta -> orange, Space Grotesk (display) + Inter (body), pill shape scale.
 */

export interface ColorScheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  /** Fixed white; use for text/icons on Card variant="gradient" or the brand gradient generally.
   *  NOT the same as onPrimary, which is tuned for the pastel `primary` swatch, not the saturated brand gradient. */
  onGradient: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  accent: string;
  onAccent: string;
  surface: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  success: string;
  successContainer: string;
  onSuccessContainer: string;
  warning: string;
  warningContainer: string;
  onWarningContainer: string;
  scrim: string;
}

export const lightColors: ColorScheme = {
  primary: '#6D28D9',
  onPrimary: '#FFFFFF',
  onGradient: '#FFFFFF',
  primaryContainer: '#EDE9FE',
  onPrimaryContainer: '#2E1065',
  secondaryContainer: '#FCE7F3',
  onSecondaryContainer: '#831843',
  accent: '#DB2777',
  onAccent: '#FFFFFF',
  surface: '#F7F5FC',
  surfaceContainerLow: '#FFFFFF',
  surfaceContainer: '#EFECF8',
  surfaceContainerHigh: '#E6E1F3',
  onSurface: '#15121F',
  onSurfaceVariant: '#565170',
  outline: '#7A7493',
  outlineVariant: '#E0DBEE',
  error: '#B3261E',
  onError: '#FFFFFF',
  errorContainer: '#F9DEDC',
  onErrorContainer: '#410E0B',
  success: '#15803D',
  successContainer: '#DCFCE7',
  onSuccessContainer: '#14532D',
  warning: '#B45309',
  warningContainer: '#FEF3C7',
  onWarningContainer: '#78350F',
  scrim: 'rgba(11,10,18,0.5)',
};

/**
 * "Aurora Night" (2026-09-27): midnight-blue surfaces, analogous indigo → violet → rose accents,
 * soft white text (less glare). Chosen to be calm on the eyes while staying vivid.
 */
export const darkColors: ColorScheme = {
  primary: '#A5B4FC',
  onPrimary: '#1E1B4B',
  onGradient: '#FFFFFF',
  primaryContainer: '#2E2A78',
  onPrimaryContainer: '#E0E7FF',
  secondaryContainer: '#123C45',
  onSecondaryContainer: '#CCFBF1',
  accent: '#5EEAD4',
  onAccent: '#042F2E',
  surface: '#0B1020',
  surfaceContainerLow: '#121833',
  surfaceContainer: '#182042',
  surfaceContainerHigh: '#212A52',
  onSurface: '#E8ECF8',
  onSurfaceVariant: '#A9B2D3',
  outline: '#7F8AB5',
  outlineVariant: '#2A3462',
  error: '#FCA5A5',
  onError: '#4C0519',
  errorContainer: '#5B1A24',
  onErrorContainer: '#FFE4E6',
  success: '#6EE7B7',
  successContainer: '#0F3B32',
  onSuccessContainer: '#D1FAE5',
  warning: '#FCD34D',
  warningContainer: '#3D2E0F',
  onWarningContainer: '#FEF3C7',
  scrim: 'rgba(3,6,18,0.7)',
};

/**
 * Brand identity (design-system/social-publisher/BROADCAST.md). Gradient order is fixed.
 * `start`/`mid`/`end` are the canonical names; `violet`/`magenta`/`orange` are legacy aliases
 * for the same three stops (kept so existing components keep compiling), not literal hues.
 */
const brandStops = { start: '#6366F1', mid: '#8B5CF6', end: '#F0A6CA' } as const;
export const brand = {
  ...brandStops,
  violet: brandStops.start,
  magenta: brandStops.mid,
  orange: brandStops.end,
  /** Warm spark (logo orbit dot, small highlights). */
  warm: '#FDBA74',
  /** Soft aqua for "live"/success highlights. */
  aqua: '#5EEAD4',
  ink: '#0B1020',
  gradient: [brandStops.start, brandStops.mid, brandStops.end] as const,
} as const;

/** Font family per weight; loaded in the root layout via expo-font. Don't combine with fontWeight. */
export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displaySemi: 'SpaceGrotesk_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
} as const;

/** Brand marks are always paired with a text label, never used as the only signal. */
export const platformBrand: Record<string, { color: string; icon: 'youtube' | 'instagram' | 'facebook' | 'web'; name: string }> = {
  youtube: { color: '#FF0033', icon: 'youtube', name: 'YouTube' },
  instagram: { color: '#E1306C', icon: 'instagram', name: 'Instagram' },
  facebook: { color: '#1877F2', icon: 'facebook', name: 'Facebook' },
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** Radius: xs 6, sm 10, md 14, lg 20 (cards), xl 28, full (pills/buttons). */
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, full: 999 } as const;

/**
 * Type roles. Headings use Space Grotesk, body/labels use Inter — set via `fontFamily` only
 * (never combine with `fontWeight`, which fakes bold on Android and breaks the family lookup).
 */
export const typography = {
  displaySmall: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.5 },
  headlineMedium: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  headlineSmall: { fontFamily: fonts.displaySemi, fontSize: 24, lineHeight: 30 },
  titleLarge: { fontFamily: fonts.displaySemi, fontSize: 20, lineHeight: 26 },
  titleMedium: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 24 },
  titleSmall: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 20 },
  bodyLarge: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  bodySmall: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  labelLarge: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 20, letterSpacing: 0.1 },
  labelMedium: { fontFamily: fonts.bodySemi, fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
  /** Analytics stat numbers: tabular figures so digits don't shift width as they count up. */
  stat: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, fontVariant: ['tabular-nums'] as ['tabular-nums'] },
} as const;

export type TypeRole = keyof typeof typography;

export const touchTarget = 48;

/** Duration tokens (ms) plus the shared Reanimated spring used for press feedback and sheets. */
export const motion = {
  fast: 150,
  standard: 250,
  emphasized: 450,
  spring: { damping: 16, stiffness: 180, mass: 1 },
} as const;

/**
 * Light-mode elevation: soft violet-tinted shadow. Dark mode uses no shadow — cards get a
 * 1px `outlineVariant` border instead (see Card). Spread onto a View's style alongside backgroundColor.
 */
export const elevation = {
  light: {
    shadowColor: '#2E1065',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
} as const;
