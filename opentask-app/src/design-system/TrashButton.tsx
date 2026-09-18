import { Trash2 } from "lucide-react";
import React, { type ButtonHTMLAttributes } from "react";

interface TrashButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    title?: "Delete";
    size?: 13;
};

export const TrashButton: React.FC<TrashButtonProps> = ({
    title = "Delete",
    size = 13,
    ...props
}) => {
    return (
        <button
            type="button"
            {...props}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-none hover:bg-[#FF3333] hover:text-white text-neutral-400 border border-transparent hover:border-black transition-all cursor-pointer"
            title={title}>
            <Trash2 size={size}/>
        </button>
    );
}
