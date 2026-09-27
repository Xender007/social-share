import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { IconName } from '@/components/ui/button';
import type { ColorScheme } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

/** Colours + icon for one timeline dot. bg/fg are ColorScheme keys so dots stay theme-aware. */
export interface TimelineDotTone {
  bg: keyof ColorScheme;
  fg: keyof ColorScheme;
  icon: IconName;
}

/**
 * "3m ago" / "2h ago" / "5d ago", falling back to a short date past a week.
 * Status is always shown as icon + text elsewhere — this is a supplementary timestamp only.
 */
export function formatRelativeTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return 'just now';
  const min = Math.round(abs / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * One row of a vertical status timeline: a coloured dot with a status icon on the left (connected
 * by a line to the next row), arbitrary content on the right. Set `last` on the final row to omit the line.
 */
export function TimelineRow({ tone, last, children }: { tone: TimelineDotTone; last?: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: colors[tone.bg] }]}>
          <MaterialCommunityIcons name={tone.icon} size={14} color={colors[tone.fg]} />
        </View>
        {!last ? <View style={[styles.line, { backgroundColor: colors.outlineVariant }]} /> : null}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', width: 28 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, marginVertical: 4, minHeight: 12 },
  content: { flex: 1, paddingBottom: 16 },
});
