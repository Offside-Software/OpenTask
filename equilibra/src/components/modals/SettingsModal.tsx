import React, { useState } from 'react';
import { X, Send, ExternalLink, Shield, Bell, User, Sun, Moon } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { updateTelegramChatId } from '../../auth/api';
import { useTheme } from '../../context/themeContext';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const { user, refreshUser } = useAuth();
    const { theme, setTheme } = useTheme();
    const [chatId, setChatId] = useState(user?.db_user?.telegram_chat_id || '');
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!user?.db_user?.id) return;
        setIsSaving(true);
        setMessage(null);
        try {
            await updateTelegramChatId(user.db_user.id, chatId);
            await refreshUser();
            setMessage({ type: 'success', text: 'Settings updated successfully!' });
            setTimeout(() => setMessage(null), 3000);
        } catch {
            setMessage({ type: 'error', text: 'Failed to update settings. Please try again.' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 select-none animate-in fade-in duration-100" onClick={onClose}>
            <div
                className="bg-[#121417] border-3 border-black rounded-none w-full max-w-md shadow-[8px_8px_0px_0px_#000000] flex flex-col overflow-hidden animate-in zoom-in-95 duration-100 font-mono"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b-2 border-black flex justify-between items-center bg-[#181B20]">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000] flex items-center justify-center">
                            <Shield size={20} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h2 className="text-white text-[16px] font-mono font-black uppercase tracking-wider">ACCOUNT SETTINGS</h2>
                            <p className="text-neutral-400 text-[11px] uppercase tracking-wider">// PROFILE & DISPATCH CHANNELS</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-none bg-black border-2 border-black text-neutral-400 hover:text-black hover:bg-[#FFE600] shadow-[2px_2px_0px_0px_#000000] transition-colors cursor-pointer">
                        <X size={18} strokeWidth={3} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* User Info Section */}
                    <section>
                        <h4 className="text-[#FFE600] text-[10px] font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                            <User size={12} /> // PROFILE SPECIFICATION
                        </h4>
                        <div className="bg-[#0B0E14] border-2 border-black rounded-none p-4 flex items-center gap-4 shadow-[2px_2px_0px_0px_#000000]">
                            <img src={user?.avatar_url} alt="Avatar" className="w-12 h-12 rounded-none border-2 border-black" />
                            <div className="min-w-0">
                                <h3 className="text-white font-black uppercase truncate text-[14px]">{user?.name || user?.login}</h3>
                                <p className="text-neutral-400 text-[11px] truncate mt-0.5">{user?.email || 'NO EMAIL CONFIGURED'}</p>
                            </div>
                        </div>
                    </section>

                    {/* Theme Section */}
                    <section>
                        <h4 className="text-[#FFE600] text-[10px] font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Sun size={12} /> // INTERFACE THEME
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => setTheme('dark')}
                                className={`p-3 rounded-none border-2 flex items-center justify-center gap-2 text-[11px] font-mono font-black uppercase tracking-wider transition-all cursor-pointer ${
                                    theme === 'dark'
                                        ? 'bg-[#FFE600] text-black border-black shadow-[3px_3px_0px_0px_#000000]'
                                        : 'bg-[#0B0E14] text-neutral-400 border-neutral-800 hover:border-white hover:text-white'
                                }`}
                            >
                                <Moon size={14} strokeWidth={2.5} /> DARK MODE
                            </button>
                            <button
                                type="button"
                                onClick={() => setTheme('light')}
                                className={`p-3 rounded-none border-2 flex items-center justify-center gap-2 text-[11px] font-mono font-black uppercase tracking-wider transition-all cursor-pointer ${
                                    theme === 'light'
                                        ? 'bg-[#FFE600] text-black border-black shadow-[3px_3px_0px_0px_#000000]'
                                        : 'bg-[#0B0E14] text-neutral-400 border-neutral-800 hover:border-white hover:text-white'
                                }`}
                            >
                                <Sun size={14} strokeWidth={2.5} /> LIGHT MODE
                            </button>
                        </div>
                    </section>

                    {/* Telegram Section */}
                    <section>
                        <h4 className="text-[#FFE600] text-[10px] font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Bell size={12} /> // TELEGRAM DISPATCH PIPELINE
                        </h4>

                        <div className="space-y-4">
                            <div>
                                <label className="text-neutral-300 text-[11px] font-bold uppercase mb-1.5 block">
                                    CHAT ID
                                </label>
                                <div className="relative group">
                                    <input
                                        type="text"
                                        value={chatId}
                                        onChange={(e) => setChatId(e.target.value)}
                                        placeholder="ENTER TELEGRAM CHAT ID"
                                        className="w-full bg-[#0B0E14] border-2 border-black rounded-none py-2.5 px-4 text-white text-[13px] font-mono focus:outline-none focus:border-[#FFE600] transition-all placeholder:text-neutral-600 shadow-[2px_2px_0px_0px_#000000]"
                                    />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 group-focus-within:text-[#FFE600] transition-colors">
                                        <Send size={15} />
                                    </div>
                                </div>
                                <p className="text-neutral-400 text-[10px] mt-1.5 uppercase leading-relaxed">
                                    SEND <code className="text-[#FFE600] font-black">/start</code> TO BOT TO RETRIEVE ID.
                                </p>
                            </div>

                            <a
                                href="https://t.me/equilibra_notif_bot"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between p-4 bg-[#141619] border-2 border-black rounded-none group hover:bg-[#FFE600] transition-all cursor-pointer shadow-[3px_3px_0px_0px_#000000]"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-none bg-black border border-black flex items-center justify-center text-[#FFE600] group-hover:text-black group-hover:bg-white">
                                        <Send size={14} />
                                    </div>
                                    <div>
                                        <span className="text-white group-hover:text-black text-[12px] font-black uppercase block">OPEN TELEGRAM BOT</span>
                                        <span className="text-neutral-400 group-hover:text-black text-[10px]">@equilibra_notif_bot</span>
                                    </div>
                                </div>
                                <ExternalLink size={14} className="text-neutral-400 group-hover:text-black transition-colors" />
                            </a>
                        </div>
                    </section>

                    {message && (
                        <div className={`p-3 rounded-none text-[11px] font-black uppercase border-2 border-black shadow-[2px_2px_0px_0px_#000000] ${
                            message.type === 'success' ? 'bg-[#22C55E] text-black' : 'bg-[#EF4444] text-white'
                        }`}>
                            {message.text}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-[#0E1012] border-t-2 border-black flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-none text-neutral-300 border-2 border-black bg-[#1E2227] text-[12px] font-black uppercase tracking-wider hover:bg-white hover:text-black shadow-[2px_2px_0px_0px_#000000] transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-5 py-2 rounded-none bg-[#FFE600] text-black border-2 border-black text-[12px] font-black uppercase tracking-wider hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[3px_3px_0px_0px_#000000] cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        {isSaving ? 'SAVING...' : 'SAVE CHANGES'}
                    </button>
                </div>
            </div>
        </div>
    );
};
