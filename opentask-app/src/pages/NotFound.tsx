import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, LayoutDashboard, Briefcase, RefreshCw } from 'lucide-react';

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
      ? 'PROJECT NOT FOUND'
      : 'PAGE NOT FOUND';

  const description =
    type === 'project'
      ? `The requested project ${resourceId ? `(#${resourceId})` : ''} does not exist, has been removed, or your credentials lack permission to access its pipeline.`
      : 'The route or resource you attempted to reach is invalid, deprecated, or offline.';

  return (
    <div className="min-h-[calc(100vh-10rem)] w-full flex items-center justify-center p-4 font-mono select-none">
      <div className="w-full max-w-lg bg-[#121417] border-3 border-black rounded-none shadow-[8px_8px_0px_0px_#000000] p-6 sm:p-8 flex flex-col items-center text-center">
        {/* Error Code Pill */}
        <div className="flex items-center gap-2 mb-6 px-3 py-1 bg-[#FFE600] text-black border-2 border-black text-[11px] font-black uppercase tracking-widest shadow-[2px_2px_0px_0px_#000000]">
          <span className="w-2 h-2 bg-black animate-pulse" />
          // ERROR // 404_NOT_FOUND
        </div>

        {/* Brutalist Warning Icon */}
        <div className="w-16 h-16 bg-black text-[#FFE600] border-3 border-black flex items-center justify-center shadow-[4px_4px_0px_0px_#000000] mb-6">
          <AlertOctagon size={32} strokeWidth={2.5} />
        </div>

        {/* Title */}
        <h1 className="text-white font-black text-[22px] sm:text-[24px] uppercase tracking-tight mb-2">
          {title}
        </h1>

        {/* Description */}
        <p className="text-neutral-400 text-[12px] leading-relaxed mb-8 max-w-sm uppercase tracking-wide">
          {description}
        </p>

        {/* Action Buttons */}
        <div className="w-full flex flex-col sm:flex-row gap-3 justify-center">
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2.5 bg-[#141619] hover:bg-neutral-800 text-white border-2 border-black font-mono text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
            >
              <RefreshCw size={14} strokeWidth={2.5} />
              <span>RETRY SYNC</span>
            </button>
          )}

          <button
            onClick={() => navigate('/workspaces')}
            className="px-4 py-2.5 bg-[#FFE600] hover:bg-[#ffe81a] text-black border-2 border-black font-mono text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-[3px_3px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
          >
            <Briefcase size={14} strokeWidth={2.5} />
            <span>WORKSPACES</span>
          </button>

          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2.5 bg-[#141619] hover:bg-[#FFE600] text-neutral-300 hover:text-black border-2 border-black font-mono text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-[2px_2px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
          >
            <LayoutDashboard size={14} strokeWidth={2.5} />
            <span>DASHBOARD</span>
          </button>
        </div>

        {/* Bottom Technical Status Bar */}
        <div className="w-full mt-8 pt-4 border-t-2 border-black flex items-center justify-between text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
          <span>// ENGINE: UNRESOLVED ROUTE</span>
          <span>HTTP 404</span>
        </div>
      </div>
    </div>
  );
};
