import { darkColors, elevation, motion, radius, spacing, typography } from './tokens';

/**
 * The app is dark-first by design (user request, 2026-09-27): violet-midnight surfaces with the
 * brand gradient glowing through, regardless of the phone's light/dark setting.
 * `lightColors` stays in tokens.ts in case a light option is added to Settings later.
 */
export function useTheme() {
  const dark = true;
  return {
    dark,
    colors: darkColors,
    spacing,
    radius,
    typography,
    motion,
    /** Dark mode uses a border, not a shadow (spec §Shape and elevation). */
    elevation: elevation.none,
  };
}

export type Theme = ReturnType<typeof useTheme>;
