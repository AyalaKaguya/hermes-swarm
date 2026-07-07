"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useTextTranslation } from "@/hooks/use-text-translation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConfirmActionDialog({
  confirmLabel,
  description,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  title,
}: {
  confirmLabel?: string;
  description: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending?: boolean;
  title: string;
}) {
  const t = useTranslations();
  const tr = useTextTranslation();
  const resolvedConfirmLabel = confirmLabel ? tr(confirmLabel) : t("common.confirm");

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{tr(title)}</DialogTitle>
        </DialogHeader>
        <p className="text-sm">{tr(description)}</p>
        <div className="flex justify-end gap-2">
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={onConfirm}
            type="button"
            variant="destructive"
          >
            {pending ? t("common.processing") : resolvedConfirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
