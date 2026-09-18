import React from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { Alert } from '../../models';
import { Badge } from '../../design-system/Badge';

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
  return createPortal(
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 select-none animate-in fade-in duration-100">
      <div className="bg-[#121417] border-3 border-black rounded-none w-full max-w-lg shadow-[8px_8px_0px_0px_#000000] flex flex-col overflow-hidden animate-in zoom-in-95 duration-100 font-mono">
        
        {/* Header */}
        <div className={`p-6 border-b-2 border-black flex items-start gap-4 ${alert.severity === 'critical' ? 'bg-[#EF4444]/15' : 'bg-[#F59E0B]/15'}`}>
          <div className={`p-3 rounded-none border-2 border-black shadow-[2px_2px_0px_0px_#000000] ${alert.severity === 'critical' ? 'bg-[#EF4444] text-white' : 'bg-[#F59E0B] text-black'}`}>
            <AlertTriangle size={22} strokeWidth={2.5} />
          </div>
          <div className="flex-1 mt-0.5">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={alert.severity === 'critical' ? 'critical' : 'warning'} className="uppercase font-mono">
                {alert.severity}
              </Badge>
              <span className="text-neutral-400 font-mono text-[11px] font-bold uppercase tracking-wider">{projectName}</span>
            </div>
            <h2 className="text-white font-mono font-black text-[18px] uppercase tracking-wide leading-tight">{alert.title}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-none bg-black border-2 border-black text-neutral-400 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer">
            <X size={18} strokeWidth={3} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-neutral-300 font-mono text-[13px] leading-relaxed mb-6">
            {alert.description}
          </p>

          <div className="bg-[#0E1012] rounded-none border-2 border-black p-4 mb-6 shadow-[3px_3px_0px_0px_#000000]">
            <h4 className="text-white font-mono text-[11px] font-black uppercase tracking-wider mb-3">// SUGGESTED ACTIONS</h4>
            <ul className="space-y-2">
              {alert.suggested_actions.map((action, idx) => (
                <li key={idx} className="flex items-start gap-2.5 text-[12px] text-neutral-300">
                  <span className="text-[#FFE600] font-black">→</span>
                  {action}
                </li>
              ))}
            </ul>
          </div>

          {/* Footer Actions */}
          <div className="flex gap-3 justify-end pt-3 border-t-2 border-neutral-800">
             <button
               onClick={() => { onResolve(); onClose(); }}
               className="flex items-center gap-2 px-4 py-2 rounded-none text-neutral-300 border-2 border-black bg-[#1E2227] text-[12px] font-black uppercase tracking-wider hover:bg-white hover:text-black shadow-[2px_2px_0px_0px_#000000] transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
             >
               <CheckCircle2 size={16} strokeWidth={2.5} /> Dismiss
             </button>
             <button
               onClick={() => { onNavigate(); onClose(); }}
               className="flex items-center gap-2 px-5 py-2 rounded-none bg-[#FFE600] text-black border-2 border-black text-[12px] font-black uppercase tracking-wider hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] shadow-[3px_3px_0px_0px_#000000] transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
             >
               View Project <ArrowRight size={16} strokeWidth={3} />
             </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
};
