import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  label: string;
  colorClass?: string;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ 
  value, 
  label, 
  colorClass = "bg-primary",
  className = ""
}) => (
  <div className={cn("w-full mt-auto", className)}>
    <div className="flex justify-between text-xs mb-1.5 font-medium">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-mono text-[11px] font-semibold">{Math.round(value)}%</span>
    </div>
    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
      <div 
        className={cn("h-full transition-all duration-300 rounded-full", colorClass)} 
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} 
      />
    </div>
  </div>
);
