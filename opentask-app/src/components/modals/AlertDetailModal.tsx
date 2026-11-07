import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { Alert } from '../../models';
import { Badge } from '../../design-system/Badge';
import { Button } from '../../design-system/Button';
import { CloseButton } from '../../design-system/CloseButton';
import { cn } from '@/lib/utils';

interface AlertDetailModalProps {
  alert: Alert;
  projectName: string;
  onClose: () => void;
  onNavigate: () => void;
  onResolve: () => void;
}

export const AlertDetailModal: React.FC<AlertDetailModalProps> = ({
  alert,
  projectName,
  onClose,
  onNavigate,
  onResolve
}) => {
  const isCritical = alert.severity === 'critical';

  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs select-none animate-in fade-in duration-150">
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={cn(
          "p-5 border-b border-border flex items-start gap-4",
          isCritical ? "bg-destructive/10" : "bg-amber-500/10"
        )}>
          <div className={cn(
            "p-2.5 rounded-full shrink-0 flex items-center justify-center",
            isCritical ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-500"
          )}>
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1 mt-0.5 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Badge variant={isCritical ? 'critical' : 'warning'} className="uppercase">
                {alert.severity}
              </Badge>
              <span className="text-muted-foreground text-xs font-medium">{projectName}</span>
            </div>
            <h2 className="text-foreground font-semibold text-base leading-snug">{alert.title}</h2>
          </div>
          <CloseButton onClick={onClose} size="md" />
        </div>

        {/* Body */}
        <div className="p-5">
          <p className="text-foreground text-sm leading-relaxed mb-4">
            {alert.description}
          </p>

          {alert.suggested_actions && alert.suggested_actions.length > 0 && (
            <div className="bg-muted/30 rounded-lg border border-border p-3.5 mb-5 shadow-xs">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
                Suggested Actions
              </h4>
              <ul className="space-y-1.5">
                {alert.suggested_actions.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-foreground">
                    <span className="text-primary font-bold">→</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex gap-2.5 justify-end pt-3 border-t border-border">
            <Button
              variant="outline"
              size="md"
              onClick={() => { onResolve(); onClose(); }}
            >
              <CheckCircle2 size={15} />
              <span>Dismiss</span>
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => { onNavigate(); onClose(); }}
            >
              <span>View project</span>
              <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
