import { Button } from '@/components/ui/button';
import type { IconName } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetDetailRows, SheetFooter, type SheetDetailRow } from '@/components/sheet';

export interface ConfirmActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  rows: SheetDetailRow[];
  confirmLabel: string;
  confirmIcon?: IconName;
  confirmVariant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'danger';
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
}

/** Generic confirm-before-you-act sheet used for retry/cancel/resolve actions on a publication. */
export function ConfirmActionSheet({
  open,
  onOpenChange,
  title,
  description,
  rows,
  confirmLabel,
  confirmIcon,
  confirmVariant = 'filled',
  cancelLabel = 'Not now',
  loading,
  onConfirm,
}: ConfirmActionSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={title} description={description}>
        {rows.length > 0 ? <SheetDetailRows rows={rows} /> : null}
        <SheetFooter>
          <Button label={confirmLabel} icon={confirmIcon} variant={confirmVariant} onPress={onConfirm} loading={loading} fullWidth />
          <SheetClose asChild>
            <Button label={cancelLabel} variant="text" fullWidth />
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
