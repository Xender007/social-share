import { TextField } from '@/components/ui/text-field';
import { StyleSheet, View } from 'react-native';

export interface CaptionStepProps {
  title: string;
  setTitle: (t: string) => void;
  caption: string;
  setCaption: (c: string) => void;
  titleNeeded: boolean;
  titleMax: number;
  captionMax: number;
}

/** Roomy title + caption fields, each with a character counter. */
export function CaptionStep({ title, setTitle, caption, setCaption, titleNeeded, titleMax, captionMax }: CaptionStepProps) {
  return (
    <View style={styles.gap}>
      <TextField
        testID="create-title"
        label={titleNeeded ? 'Title *' : 'Title'}
        value={title}
        onChangeText={setTitle}
        maxLength={titleMax}
        showCounter
        helper={titleNeeded ? 'YouTube needs a title. If empty, the first caption line is used.' : undefined}
      />
      <TextField testID="create-caption" label="Caption" value={caption} onChangeText={setCaption} multiline maxLength={captionMax} showCounter />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
});
