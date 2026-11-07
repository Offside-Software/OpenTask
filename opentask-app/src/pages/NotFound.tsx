import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, LayoutDashboard, Briefcase, RefreshCw } from 'lucide-react';
import { Button } from '../design-system/Button';
import { Badge } from '../design-system/Badge';

interface NotFoundProps {
  type?: 'project' | 'page';
  resourceId?: string | number;
  onRetry?: () => void;
}

export const NotFoundPage: React.FC<NotFoundProps> = ({
  type = 'page',
  resourceId,
  onRetry,
}) => {
  const navigate = useNavigate();

  const title =
    type === 'project'
      ? 'Project Not Found'
      : 'Page Not Found';

  const description =
    type === 'project'
      ? `The requested project ${resourceId ? `(#${resourceId})` : ''} does not exist, has been removed, or your credentials lack permission to access its pipeline.`
      : 'The route or resource you attempted to reach is invalid, deprecated, or offline.';

  return (
    <div className="min-h-[calc(100vh-10rem)] w-full flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg bg-card text-card-foreground border border-border rounded-xl shadow-xl p-6 sm:p-8 flex flex-col items-center text-center animate-in zoom-in-95 duration-100">
        {/* Error Code Pill */}
        <div className="mb-5">
          <Badge variant="danger">
            Error 404
          </Badge>
        </div>

        {/* Warning Icon */}
        <div className="w-14 h-14 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-5">
          <AlertOctagon size={28} />
        </div>

        {/* Title */}
        <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-2">
          {title}
        </h1>

        {/* Description */}
        <p className="text-muted-foreground text-xs leading-relaxed mb-6 max-w-sm">
          {description}
        </p>

        {/* Action Buttons */}
        <div className="w-full flex flex-col sm:flex-row gap-2.5 justify-center">
          {onRetry && (
            <Button
              variant="outline"
              size="md"
              onClick={onRetry}
              className="flex items-center justify-center gap-2"
            >
              <RefreshCw size={14} />
              <span>Retry Sync</span>
            </Button>
          )}

          <Button
            variant="primary"
            size="md"
            onClick={() => navigate('/workspaces')}
            className="flex items-center justify-center gap-2"
          >
            <Briefcase size={14} />
            <span>Workspaces</span>
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={() => navigate('/dashboard')}
            className="flex items-center justify-center gap-2"
          >
            <LayoutDashboard size={14} />
            <span>Dashboard</span>
          </Button>
        </div>

        {/* Bottom Technical Status Bar */}
        <div className="w-full mt-6 pt-3.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>Unresolved Route</span>
          <span>HTTP 404</span>
        </div>
      </div>
    </div>
  );
};
