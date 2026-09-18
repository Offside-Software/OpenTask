import React from 'react';
import './LoadingScreen.css';

interface LoadingScreenProps {
  message?: string;
  subtext?: string;
  fullscreen?: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'INITIALIZING SYSTEM…',
  subtext,
  fullscreen = true,
}) => {
  return (
    <div
      className={`${
        fullscreen ? 'min-h-screen w-full fixed inset-0 z-50' : 'min-h-[calc(100vh-14rem)] w-full flex-1'
      } bg-dots text-white flex items-center justify-center p-4 font-mono select-none`}
    >
      <div className="w-full max-w-md bg-[#121417] border-3 border-black rounded-none shadow-[8px_8px_0px_0px_#000000] p-6 sm:p-8 flex flex-col items-center">
        {/* Technical Status Pill */}
        <div className="flex items-center gap-2 mb-6 px-3 py-1 bg-[#FFE600] text-black border-2 border-black text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0px_0px_#000000]">
          <span className="w-2 h-2 bg-black animate-pulse" />
          SYSTEM // STANDBY
        </div>

        {/* Brutalist Spinning Square Indicator */}
        <div className="relative mb-6">
          <div
            className="w-12 h-12 border-4 border-black border-t-[#FFE600] border-r-[#FFE600] rounded-none animate-spin shadow-[3px_3px_0px_0px_#000000]"
            role="status"
            aria-label="Loading"
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-3 h-3 bg-[#FFE600] border border-black" />
          </div>
        </div>

        {/* Message & Subtext */}
        <h3 className="text-white font-mono font-black text-[15px] sm:text-[16px] uppercase tracking-wider text-center mb-1.5">
          {message}
        </h3>

        <p className="text-neutral-400 font-mono text-[11px] uppercase tracking-wide text-center">
          {subtext || '// SYNCHRONIZING WITH OPENTASK ENGINE'}
        </p>

        {/* Brutalist Pulse Steps */}
        <div className="w-full mt-6 pt-4 border-t-2 border-black flex items-center justify-between">
          <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">// STATUS: ACTIVE</span>
          <div className="flex gap-1.5">
            <span className="w-2 h-2 bg-[#FFE600] border border-black animate-pulse" />
            <span className="w-2 h-2 bg-neutral-700 border border-black" />
            <span className="w-2 h-2 bg-neutral-700 border border-black" />
          </div>
        </div>
      </div>
    </div>
  );
};
