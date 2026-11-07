import React from 'react';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Button } from '../../design-system/Button';
import { cn } from '@/lib/utils';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'danger'
}) => {
  const iconConfig = {
    danger: {
      icon: AlertCircle,
      bg: 'bg-destructive/15 text-destructive',
      btnVariant: 'danger' as const
    },
    warning: {
      icon: AlertTriangle,
      bg: 'bg-amber-500/15 text-amber-500',
      btnVariant: 'primary' as const
    },
    info: {
      icon: Info,
      bg: 'bg-primary/15 text-primary',
      btnVariant: 'primary' as const
    }
  };

  const current = iconConfig[variant] || iconConfig.danger;
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs z-[100] flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-md shadow-xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={cn("p-2.5 rounded-full shrink-0", current.bg)}>
              <Icon size={20} />
            </div>
            <div className="flex-1">
              <h2 className="text-foreground font-semibold text-base">
                {title}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed mt-1">
                {message}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-3.5 bg-muted/30 border-t border-border flex justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={current.btnVariant}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
