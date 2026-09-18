import React from 'react';

interface SurfaceCardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
  icon?: React.ElementType;
}

export const SurfaceCard: React.FC<SurfaceCardProps> = ({ 
  children, 
  className = "", 
  title, 
  subtitle, 
  rightElement, 
  icon: Icon 
}) => (
  <div className={`p-5 rounded-none border-2 border-neutral-700 bg-[#141619] shadow-[4px_4px_0px_0px_#000000] flex flex-col ${className}`}>
    {(title || rightElement || Icon) && (
      <div className="flex justify-between items-start pb-4 mb-4 border-b-2 border-neutral-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="p-2 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000] flex-shrink-0">
              <Icon size={16} strokeWidth={2.5} />
            </div>
          )}
          <div>
            {title && (
              <h3 className="text-white font-bold text-[13px] uppercase tracking-wider font-mono">
                <span className="text-[#FFE600] mr-1.5">//</span>{title}
              </h3>
            )}
            {subtitle && (
              <p className="text-neutral-400 font-mono text-[11px] mt-0.5 uppercase tracking-wider">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {rightElement}
      </div>
    )}
    {children}
  </div>
);
