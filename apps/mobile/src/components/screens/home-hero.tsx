import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, View } from 'react-native';
import { BrandMark } from '@/components/brand/brand-mark';
import { Card } from '@/components/ui/card';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { brand, radius } from '@/theme/tokens';

/** Text on the brand gradient is always white (BROADCAST.md §Colour), independent of theme. */
const WHITE = '#FFFFFF';

interface HomeHeroCardProps {
  draftFileName: string | null;
  canPublish: boolean;
  onPress: () => void;
}

/**
 * "Create post" hero: brand gradient card with a low-opacity BrandMark watermark and a white
 * pill CTA (dark ink text/icon so it reads on any gradient stop).
 */
export function HomeHeroCard({ draftFileName, canPublish, onPress }: HomeHeroCardProps) {
  const hasDraft = !!draftFileName;

  return (
    <Card variant="gradient" style={styles.hero}>
      <View pointerEvents="none" style={styles.watermark}>
        <BrandMark size={148} monochrome color="rgba(255,255,255,0.14)" />
      </View>
      <View style={styles.heroText}>
        <Text role="headlineSmall" style={styles.white}>
          {hasDraft ? 'Continue your post' : 'Share a new video'}
        </Text>
        <Text role="bodyMedium" style={styles.whiteSoft} numberOfLines={2}>
          {hasDraft ? draftFileName : 'Pick a video, write a caption once, publish to every platform.'}
        </Text>
      </View>
      <PressableScale
        testID="home-create"
        onPress={onPress}
        disabled={!canPublish}
        haptic
        accessibilityRole="button"
        accessibilityLabel={hasDraft ? 'Continue draft' : 'Create post'}
        accessibilityState={{ disabled: !canPublish }}
        style={[styles.pill, { opacity: canPublish ? 1 : 0.55 }]}>
        <MaterialCommunityIcons name={hasDraft ? 'pencil' : 'plus'} size={20} color={brand.ink} />
        <Text role="labelLarge" style={styles.pillLabel}>
          {hasDraft ? 'Continue draft' : 'Create post'}
        </Text>
      </PressableScale>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 16, minHeight: 184, justifyContent: 'space-between' },
  watermark: { position: 'absolute', right: -20, bottom: -20 },
  heroText: { gap: 6, paddingRight: 48 },
  white: { color: WHITE },
  whiteSoft: { color: 'rgba(255,255,255,0.85)' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: radius.full,
    backgroundColor: WHITE,
  },
  pillLabel: { color: brand.ink },
});
