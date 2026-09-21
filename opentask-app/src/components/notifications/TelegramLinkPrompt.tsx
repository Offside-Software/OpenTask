import React, { useState } from 'react';
import { Send, ArrowRight, BellRing, X } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';

const DISMISSED_KEY = 'opentask_telegram_prompt_dismissed';

interface TelegramLinkPromptProps {
    onOpenSettings: () => void;
}

export const TelegramLinkPrompt: React.FC<TelegramLinkPromptProps> = ({ onOpenSettings }) => {
    const { user } = useAuth();

    // Initialise dismissed state from localStorage — never show again after user dismisses
    const [dismissed, setDismissed] = useState<boolean>(() => {
        try {
            return localStorage.getItem(DISMISSED_KEY) === '1';
        } catch {
            return false;
        }
    });

    const handleDismiss = () => {
        try {
            localStorage.setItem(DISMISSED_KEY, '1');
        } catch { /* ignore */ }
        setDismissed(true);
    };

    // Only show if user is logged in, has no telegram_chat_id, and hasn't dismissed before
    if (!user || user.db_user?.telegram_chat_id || dismissed) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[90] animate-in slide-in-from-right-10 fade-in duration-200 max-w-sm w-full select-none font-mono">
            <div className="bg-[#121417] border-3 border-black rounded-none shadow-[6px_6px_0px_0px_#000000] overflow-hidden p-5 relative">

                {/* Dismiss button */}
                <button
                    onClick={handleDismiss}
                    className="absolute top-3 right-3 p-1 rounded-none bg-[#1E2227] border border-neutral-700 text-neutral-400 hover:text-black hover:bg-[#FFE600] hover:border-black transition-all cursor-pointer shadow-[1px_1px_0px_0px_#000000]"
                    title="Dismiss"
                >
                    <X size={13} strokeWidth={3} />
                </button>

                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-none bg-[#FFE600] text-black border-2 border-black flex items-center justify-center shadow-[2px_2px_0px_0px_#000000] flex-shrink-0">
                        <BellRing size={22} strokeWidth={2.5} />
                    </div>

                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[#FFE600] text-[10px] font-black uppercase tracking-widest">// SETUP REQUIRED</span>
                        </div>
                        <h3 className="text-white font-mono font-black text-[15px] uppercase tracking-wide mb-1">LINK TELEGRAM BOT</h3>
                        <p className="text-neutral-400 text-[11px] leading-relaxed mb-4">
                            Receive immediate alert dispatches & meeting briefs directly on mobile via Telegram.
                        </p>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => { handleDismiss(); onOpenSettings(); }}
                                className="flex-1 bg-[#FFE600] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#000000] text-black text-[11px] font-black uppercase tracking-wider py-2.5 px-4 rounded-none border-2 border-black transition-all flex items-center justify-center gap-2 group shadow-[3px_3px_0px_0px_#000000] cursor-pointer"
                            >
                                LINK NOW <ArrowRight size={14} strokeWidth={3} className="group-hover:translate-x-1 transition-transform" />
                            </button>
                            <a
                                href="https://t.me/OffsideOpenTaskBot"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2.5 rounded-none bg-[#1E2227] border-2 border-black text-neutral-300 hover:bg-white hover:text-black shadow-[2px_2px_0px_0px_#000000] transition-all cursor-pointer"
                                title="Open Bot"
                            >
                                <Send size={15} />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
