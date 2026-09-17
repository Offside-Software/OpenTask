import React from 'react';

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
    primary: "bg-[#FFE600] text-black border-2 border-black hover:bg-[#FFF066] shadow-[3px_3px_0px_0px_#000000]",
    success: "bg-[#00FF66] text-black border-2 border-black hover:bg-[#33FF85] shadow-[3px_3px_0px_0px_#000000]",
    outline: "bg-[#141619] text-white border-2 border-neutral-700 hover:border-white hover:bg-[#1E2227] shadow-[3px_3px_0px_0px_#000000]",
    danger: "bg-[#FF3333] text-white border-2 border-black hover:bg-[#FF5555] shadow-[3px_3px_0px_0px_#000000]",
    ghost: "bg-transparent text-neutral-300 hover:text-white hover:bg-[#1E2227] border-2 border-transparent hover:border-neutral-700",
    white: "bg-white text-black border-2 border-black hover:bg-neutral-100 shadow-[3px_3px_0px_0px_#000000]"
  };

  const sizeStyles = {
    sm: "px-2.5 py-1 text-[11px]",
    md: "px-4 py-2 text-[12px]",
    lg: "px-6 py-3 text-[14px]"
  };

  return (
    <button 
      {...props}
      className={`rounded-none font-bold uppercase tracking-wider transition-all duration-75 flex items-center justify-center gap-2 cursor-pointer select-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
    >
      {children}
    </button>
  );
};
