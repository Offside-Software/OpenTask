import { X } from "lucide-react";
import React from "react";

interface CloseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    size?: 'sm' | 'md' | 'lg';
}

export const CloseButton: React.FC<CloseButtonProps> = ({
    size = 'md',
    ...props
}) => {
    const sizePaddingStyles = {
        sm: 'p-0.5',
        md: 'p-1',
        lg: 'p-2'
    }

    const xSizeStyles = {
        sm: 12,
        md: 18,
        lg: 24
    }

    return (
        <button
            {...props} 
            className={`${sizePaddingStyles[size]} rounded-none bg-black border-2 border-neutral-700 text-neutral-400 hover:text-black hover:bg-[#FF0000] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer`}>
            <X size={xSizeStyles[size]} strokeWidth={3}/>
        </button>
    );
};
