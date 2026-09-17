import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: "critical" | "success" | "warning" | "primary" | "default" | "outline";
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ 
  children, 
  variant = "default", 
  className = "" 
}) => {
  const styles = {
    critical: "bg-[#FF3333] text-white border-black shadow-[1.5px_1.5px_0px_0px_#000000]",
    success: "bg-[#00FF66] text-black border-black shadow-[1.5px_1.5px_0px_0px_#000000]",
    warning: "bg-[#FFE600] text-black border-black shadow-[1.5px_1.5px_0px_0px_#000000]",
    primary: "bg-[#00E5FF] text-black border-black shadow-[1.5px_1.5px_0px_0px_#000000]",
    default: "bg-[#1E2227] text-neutral-200 border-neutral-700 shadow-[1.5px_1.5px_0px_0px_#000000]",
    outline: "bg-transparent text-neutral-300 border-neutral-600 shadow-[1.5px_1.5px_0px_0px_#000000]"
  };

  return (
    <span className={`px-2 py-0.5 rounded-none font-mono text-[10px] font-bold uppercase tracking-wider border-2 ${styles[variant]} inline-flex items-center gap-1 w-fit select-none ${className}`}>
      {children}
    </span>
  );
};
