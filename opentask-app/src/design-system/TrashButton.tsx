import { Trash2 } from "lucide-react";
import React, { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface TrashButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title?: string;
  size?: number;
}

export const TrashButton: React.FC<TrashButtonProps> = ({
  title = "Delete",
  size = 14,
  className = "",
  ...props
}) => {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      title={title}
      aria-label={title}
    >
      <Trash2 size={size} strokeWidth={2} />
    </button>
  );
};
