import React from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'outline' | 'danger' | 'ghost' | 'white';
  size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md',
  className = '', 
  ...props 
}) => {
  const variantStyles = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs active:opacity-90",
    success: "bg-emerald-600 text-white hover:bg-emerald-500 shadow-xs dark:bg-emerald-600 dark:hover:bg-emerald-500",
    outline: "border border-border bg-background/50 hover:bg-muted text-foreground shadow-xs",
    danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs",
    ghost: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/70",
    white: "bg-background text-foreground border border-border hover:bg-muted shadow-xs"
  };

  const sizeStyles = {
    sm: "h-8 px-2.5 text-xs rounded-md gap-1.5",
    md: "h-9 px-3.5 text-sm rounded-md gap-2",
    lg: "h-10 px-5 text-sm rounded-lg gap-2.5"
  };

  return (
    <button 
      {...props}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors select-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        sizeStyles[size],
        variantStyles[variant],
        className
      )}
    >
      {children}
    </button>
  );
};
