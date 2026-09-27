import { StyleSheet, View } from 'react-native';
import { GradientFill } from '@/components/ui/gradient';
import { Text } from '@/components/ui/text';
import { radius } from '@/theme/tokens';

/** Small numbered step header used across the Create Post flow: a gradient circle + a title. */
export function StepHeader({ step, title }: { step: number; title: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.circle}>
        <GradientFill borderRadius={radius.full} />
        <Text role="titleSmall" color="onGradient">
          {step}
        </Text>
      </View>
      <Text role="titleMedium" accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  circle: { width: 28, height: 28, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
