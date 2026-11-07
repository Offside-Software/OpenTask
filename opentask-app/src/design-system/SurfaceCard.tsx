import React from 'react';
import { cn } from '@/lib/utils';

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
  <div className={cn("p-5 rounded-xl border border-border bg-card text-card-foreground shadow-xs flex flex-col transition-all", className)}>
    {(title || rightElement || Icon) && (
      <div className="flex justify-between items-start pb-3.5 mb-4 border-b border-border/70 flex-shrink-0">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20 flex-shrink-0 flex items-center justify-center">
              <Icon size={16} strokeWidth={2} />
            </div>
          )}
          <div>
            {title && (
              <h3 className="text-foreground font-semibold text-sm tracking-tight">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-muted-foreground text-xs mt-0.5">
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
