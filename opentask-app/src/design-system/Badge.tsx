import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: "critical" | "danger" | "success" | "warning" | "primary" | "accent" | "default" | "neutral" | "outline";
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ 
  children, 
  variant = "default", 
  className = "" 
}) => {
  const styles: Record<string, string> = {
    critical: "bg-destructive/15 text-destructive border-destructive/30",
    danger: "bg-destructive/15 text-destructive border-destructive/30",
    success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    primary: "bg-primary/15 text-primary border-primary/30",
    accent: "bg-primary/15 text-primary border-primary/30",
    default: "bg-muted text-muted-foreground border-border",
    neutral: "bg-muted text-muted-foreground border-border",
    outline: "bg-transparent text-foreground border-border"
  };

  const selectedStyle = styles[variant] || styles.default;

  return (
    <span className={cn(
      "px-2 py-0.5 rounded-md font-medium text-[11px] border inline-flex items-center gap-1 w-fit select-none transition-colors",
      selectedStyle,
      className
    )}>
      {children}
    </span>
  );
};
