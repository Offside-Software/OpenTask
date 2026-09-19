import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { taskService } from '../services/taskService';
import { LoadingScreen } from '../components/ui/LoadingScreen';
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
      <div className="max-w-[540px] mx-auto mt-20 p-8 bg-[#121417] border-3 border-black shadow-[6px_6px_0px_0px_#000000] font-mono text-center select-none">
        <div className="w-14 h-14 mx-auto mb-4 bg-black border-2 border-black text-[#EF4444] flex items-center justify-center shadow-[2px_2px_0px_0px_#000000]">
          <AlertTriangle size={28} strokeWidth={2.5} />
        </div>
        <div className="text-[#EF4444] text-[11px] font-black uppercase tracking-wider mb-1">
          // TASK REDIRECT FAILED
        </div>
        <h2 className="text-white text-[20px] font-black uppercase mb-3">TASK NOT FOUND</h2>
        <p className="text-neutral-400 text-[12px] mb-6 leading-relaxed">
          {error}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => resolveRedirect()}
            disabled={isRetrying}
            className="px-4 py-2 border-2 border-black bg-[#FFE600] text-black text-[11px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={isRetrying ? 'animate-spin' : ''} />
            <span>RETRY</span>
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 border-2 border-black bg-[#1E2227] text-white text-[11px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer flex items-center gap-1.5"
          >
            <ArrowLeft size={13} />
            <span>DASHBOARD</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <LoadingScreen
        fullscreen={false}
        message={`REDIRECTING TO TASK #${taskId || '…'}`}
        subtext="// LOCATING PROJECT BOARD & OPENING WORKSPACE"
      />
    </div>
  );
};
