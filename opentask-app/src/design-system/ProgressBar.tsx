import React from 'react';

interface ProgressBarProps {
  value: number;
  label: string;
  colorClass?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ 
  value, 
  label, 
  colorClass = "bg-[#FFE600]" 
}) => (
  <div className="w-full mt-auto">
    <div className="flex justify-between text-[11px] mb-1.5 font-bold font-mono uppercase tracking-wider">
      <span className="text-neutral-400">{label}</span>
      <span className="text-white bg-neutral-800 px-1.5 py-0.5 border border-neutral-700">{value}%</span>
    </div>
    <div className="w-full bg-[#1E2227] h-3 rounded-none border-2 border-black overflow-hidden shadow-[2px_2px_0px_0px_#000000]">
      <div 
        className={`h-full transition-all duration-300 ${colorClass}`} 
        style={{ width: `${Math.min(value, 100)}%` }} 
      />
    </div>
  </div>
);
