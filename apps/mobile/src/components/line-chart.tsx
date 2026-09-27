import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '@/theme/use-theme';
import { Text } from './ui/text';

export interface ChartSeries {
  label: string;
  color: string;
  points: Array<{ date: string; value: number }>;
  dashed?: boolean;
  /** SVG dash pattern; lets series with similar colours (YouTube red, Instagram pink) stay distinguishable. */
  dash?: string;
}

const dashOf = (s: ChartSeries) => s.dash ?? (s.dashed ? '6 4' : undefined);

export const compactNumber = (value: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Minimal accessible line chart: legend, labelled axes, and a text summary for screen readers. */
export function LineChart({ series, height = 180, width = 320 }: { series: ChartSeries[]; height?: number; width?: number }) {
  const { colors } = useTheme();
  const gradientId = useId().replace(/[:]/g, '');
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (dates.length < 2 || values.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text role="bodyMedium" color="onSurfaceVariant">
          Not enough data yet. Sync again tomorrow.
        </Text>
      </View>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || 1;
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const left = 8;
  const right = width - 8;
  const top = 8;
  const bottom = height - 8;
  const x = (date: string) => left + ((right - left) * dates.indexOf(date)) / (dates.length - 1);
  const y = (value: number) => bottom - ((bottom - top) * (value - lo)) / (hi - lo);

  const primary = series[0];
  const first = primary.points[0];
  const last = primary.points[primary.points.length - 1];
  const summary = `${primary.label}: ${compactNumber(first.value)} on ${shortDate(first.date)}, ${compactNumber(last.value)} on ${shortDate(last.date)}.`;

  // Gradient area fill lives under the hero (first) series only, so overlapping series stay legible.
  const areaPath = (s: ChartSeries) => {
    const line = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const lastX = x(s.points[s.points.length - 1].date).toFixed(1);
    const firstX = x(s.points[0].date).toFixed(1);
    return `${line} L${lastX},${bottom.toFixed(1)} L${firstX},${bottom.toFixed(1)} Z`;
  };

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <View style={styles.axisRow}>
        <Text role="bodySmall" color="onSurfaceVariant">
          {compactNumber(hi)}
        </Text>
      </View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`chart-area-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={primary.color} stopOpacity={0.32} />
            <Stop offset="100%" stopColor={primary.color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <Line key={f} x1={left} x2={right} y1={top + (bottom - top) * f} y2={top + (bottom - top) * f} stroke={colors.outlineVariant} strokeWidth={1} strokeOpacity={0.6} />
        ))}
        {primary.points.length > 1 ? <Path d={areaPath(primary)} fill={`url(#chart-area-${gradientId})`} stroke="none" /> : null}
        {series.map((s) => {
          const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
          return (
            <Path key={s.label} d={d} stroke={s.color} strokeWidth={2.5} fill="none" strokeDasharray={dashOf(s)} strokeLinejoin="round" strokeLinecap="round" />
          );
        })}
        {series.map((s) => {
          const end = s.points[s.points.length - 1];
          return end ? <Circle key={`${s.label}-end`} cx={x(end.date)} cy={y(end.value)} r={4} fill={s.color} /> : null;
        })}
      </Svg>
      <View style={styles.axisRow}>
        <Text role="bodySmall" color="onSurfaceVariant">
          {compactNumber(lo)} · {shortDate(dates[0])}
        </Text>
        <Text role="bodySmall" color="onSurfaceVariant">
          {shortDate(dates[dates.length - 1])}
        </Text>
      </View>
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendItem}>
            {/* The swatch repeats the line's dash pattern so the legend matches without relying on colour alone. */}
            <Svg width={24} height={6}>
              <Line x1={1} x2={23} y1={3} y2={3} stroke={s.color} strokeWidth={3} strokeDasharray={dashOf(s)} strokeLinecap="round" />
            </Svg>
            <Text role="bodySmall">{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
