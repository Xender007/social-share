import { StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { ColorScheme } from '@/theme/tokens';

export interface HomeStat {
  label: string;
  value: number;
  tone?: keyof ColorScheme;
}

/** Quick stats strip — derived only from post data the Home screen already fetches. */
export function HomeStatsStrip({ stats }: { stats: HomeStat[] }) {
  return (
    <View style={styles.row}>
      {stats.map((stat) => (
        <Card key={stat.label} variant="outlined" style={styles.tile}>
          <Text role="stat" color={stat.tone ?? 'onSurface'}>
            {stat.value}
          </Text>
          <Text role="labelMedium" color="onSurfaceVariant">
            {stat.label}
          </Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, alignItems: 'flex-start', gap: 2, paddingVertical: 14 },
});
