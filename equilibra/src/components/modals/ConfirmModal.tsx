import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmModalProps {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
    variant = 'danger'
}) => {
    const variantStyles = {
        danger: {
            iconBg: 'bg-[#EF4444]',
            iconText: 'text-white',
            confirmBtn: 'bg-[#EF4444] text-white hover:bg-[#DC2626]',
            border: 'border-black'
        },
        warning: {
            iconBg: 'bg-[#F59E0B]',
            iconText: 'text-black',
            confirmBtn: 'bg-[#F59E0B] text-black hover:bg-[#D97706]',
            border: 'border-black'
        },
        info: {
            iconBg: 'bg-[#FFE600]',
            iconText: 'text-black',
            confirmBtn: 'bg-[#FFE600] text-black hover:bg-[#E6CF00]',
            border: 'border-black'
        }
    };

    const currentStyles = variantStyles[variant];

    return (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 select-none animate-in fade-in duration-100" onClick={onCancel}>
            <div
                className="bg-[#121417] border-3 border-black rounded-none w-full max-w-sm shadow-[8px_8px_0px_0px_#000000] overflow-hidden animate-in zoom-in-95 duration-100"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`p-3 rounded-none border-2 border-black ${currentStyles.iconBg} ${currentStyles.iconText} shadow-[2px_2px_0px_0px_#000000] shrink-0`}>
                            <AlertTriangle size={24} strokeWidth={2.5} />
                        </div>
                        <div className="flex-1 font-mono">
                            <h2 className="text-white font-mono font-black uppercase text-base mb-1.5">{title}</h2>
                            <p className="text-neutral-300 font-mono text-[12px] leading-relaxed">{message}</p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 bg-[#0E1012] border-t-2 border-black flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 rounded-none text-[12px] font-mono font-black uppercase tracking-wider text-neutral-300 border-2 border-black bg-[#1E2227] shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onConfirm();
                        }}
                        className={`px-5 py-2 rounded-none text-[12px] font-mono font-black uppercase tracking-wider border-2 border-black shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px] ${currentStyles.confirmBtn}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
