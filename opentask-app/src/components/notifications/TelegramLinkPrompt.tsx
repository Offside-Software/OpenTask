import React, { useState } from 'react';
import { Send, ArrowRight, BellRing, X } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../design-system/Button';

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

    const botLink = user?.db_user?.id
        ? `https://t.me/OffsideOpenTaskBot?start=link_${user.db_user.id}`
        : (user?.login ? `https://t.me/OffsideOpenTaskBot?start=link_${user.login}` : 'https://t.me/OffsideOpenTaskBot');

    return (
        <div className="fixed bottom-6 right-6 z-[90] animate-in slide-in-from-bottom-5 fade-in duration-200 max-w-sm w-full select-none">
            <div className="bg-card text-card-foreground border border-border rounded-xl shadow-lg overflow-hidden p-5 relative">

                {/* Dismiss button */}
                <button
                    onClick={handleDismiss}
                    className="absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                    title="Dismiss"
                >
                    <X size={14} />
                </button>

                <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                        <BellRing size={20} />
                    </div>

                    <div className="flex-1 min-w-0 pr-4">
                        <span className="text-primary text-[10px] font-semibold uppercase tracking-wider block mb-1">Setup Required</span>
                        <h3 className="text-foreground font-semibold text-sm mb-1">Link Telegram Bot</h3>
                        <p className="text-muted-foreground text-xs leading-relaxed mb-4">
                            Receive immediate alert dispatches & meeting briefs directly on mobile via Telegram.
                        </p>

                        <div className="flex items-center gap-2">
                            <Button
                                onClick={() => { handleDismiss(); onOpenSettings(); }}
                                variant="primary"
                                size="sm"
                                className="flex-1 text-xs"
                            >
                                Link Now <ArrowRight size={14} className="ml-1" />
                            </Button>
                            <a
                                href={botLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 rounded-lg border border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                                title="Open Bot"
                            >
                                <Send size={14} />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
