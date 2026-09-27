import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetFooter } from '@/components/sheet';
import { Banner } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { api, ApiError } from '@/lib/api';

export interface EditNameSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
}

const MAX_LENGTH = 50;

/** Lets the signed-in user change their display name (blueprint: profile card, Settings). */
export function EditNameSheet({ open, onOpenChange, currentName }: EditNameSheetProps) {
  const qc = useQueryClient();
  const [name, setName] = useState(currentName);

  // Re-seed the field with the latest saved name each time the sheet opens.
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const update = useMutation({
    mutationFn: () => api.updateMe({ displayName: name.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['capabilities'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      onOpenChange(false);
    },
  });

  const trimmed = name.trim();
  const fieldError = trimmed.length === 0 ? 'Enter your name.' : trimmed.length > MAX_LENGTH ? `Keep it under ${MAX_LENGTH} characters.` : null;

  return (
    <Sheet open={open} onOpenChange={(next) => (!update.isPending ? onOpenChange(next) : undefined)}>
      <SheetContent title="Your name">
        <TextField
          label="Display name"
          value={name}
          onChangeText={setName}
          maxLength={MAX_LENGTH + 20}
          showCounter
          error={fieldError}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!fieldError) update.mutate();
          }}
        />
        {update.error ? <Banner tone="error" message={update.error instanceof ApiError ? update.error.message : 'Could not save your name.'} /> : null}
        <SheetFooter>
          <Button label="Save" onPress={() => update.mutate()} loading={update.isPending} disabled={Boolean(fieldError)} fullWidth />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
