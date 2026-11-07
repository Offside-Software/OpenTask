import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { taskService } from '../services/taskService';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { Button } from '../design-system/Button';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';

export const TaskRedirectPage: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const resolveRedirect = React.useCallback(async () => {
    if (!taskId) {
      setError('No task ID specified.');
      return;
    }
    setError(null);
    setIsRetrying(true);
    try {
      const data = await taskService.getTaskRedirect(taskId);
      if (data && data.url) {
        navigate(data.url, { replace: true });
      } else {
        setError('Task could not be located.');
      }
    } catch (err: any) {
      console.error('Failed to resolve task redirect:', err);
      setError(err?.message || `Task #${taskId} not found or has been removed.`);
    } finally {
      setIsRetrying(false);
    }
  }, [taskId, navigate]);

  useEffect(() => {
    resolveRedirect();
  }, [resolveRedirect]);

  if (error) {
    return (
      <div className="max-w-[500px] mx-auto mt-20 p-6 sm:p-8 bg-card text-card-foreground border border-border rounded-xl shadow-xl text-center select-none animate-in zoom-in-95 duration-100">
        <div className="w-14 h-14 mx-auto mb-4 bg-destructive/10 text-destructive rounded-full flex items-center justify-center">
          <AlertTriangle size={28} />
        </div>
        <div className="text-destructive text-xs font-semibold uppercase tracking-wider mb-1">
          Task Redirect Failed
        </div>
        <h2 className="text-foreground text-xl font-bold tracking-tight mb-2">Task Not Found</h2>
        <p className="text-muted-foreground text-xs mb-6 leading-relaxed">
          {error}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() => resolveRedirect()}
            disabled={isRetrying}
            className="flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={isRetrying ? 'animate-spin' : ''} />
            <span>Retry</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5"
          >
            <ArrowLeft size={13} />
            <span>Dashboard</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <LoadingScreen
        fullscreen={false}
        message={`Redirecting to task #${taskId || '…'}`}
        subtext="Locating project board & opening workspace"
      />
    </div>
  );
};
