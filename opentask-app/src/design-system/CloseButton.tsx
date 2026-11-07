import { X } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";

interface CloseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg';
}

export const CloseButton: React.FC<CloseButtonProps> = ({
  size = 'md',
  className = '',
  ...props
}) => {
  const sizeStyles = {
    sm: 'p-1 size-6',
    md: 'p-1.5 size-7',
    lg: 'p-2 size-8'
  };

  const iconSizes = {
    sm: 13,
    md: 15,
    lg: 18
  };

  return (
    <button
      type="button"
      {...props} 
      className={cn(
        "inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        sizeStyles[size],
        className
      )}
      aria-label="Close"
    >
      <X size={iconSizes[size]} strokeWidth={2} />
    </button>
  );
};
