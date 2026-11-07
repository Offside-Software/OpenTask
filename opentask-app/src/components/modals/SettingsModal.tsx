import React, { useState, useEffect } from 'react';
import { Send, ExternalLink, Shield, Bell, User, Sun, Moon, Sparkles, Eye, EyeOff, CheckCircle2, AlertTriangle, Monitor, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { updateTelegramChatId } from '../../auth/api';
import { useTheme } from '../../context/themeContext';
import { CloseButton } from '../../design-system/CloseButton';
import { Button } from '../../design-system/Button';
import { Badge } from '../../design-system/Badge';
import { aiKeyService, type UserAiKeyResponse } from '../../services/aiKeyService';
import { useUpdater } from '../updater/UpdateChecker';
import { cn } from '@/lib/utils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { user, refreshUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const { currentVersion, checkForUpdates, isChecking: isCheckingUpdates } = useUpdater();
  const [chatId, setChatId] = useState(user?.db_user?.telegram_chat_id || '');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isWaitingForLink, setIsWaitingForLink] = useState(false);

  useEffect(() => {
    if (user?.db_user?.telegram_chat_id) {
      setChatId(user.db_user.telegram_chat_id);
      if (isWaitingForLink) {
        setIsWaitingForLink(false);
        setMessage({ type: 'success', text: 'Telegram account successfully linked!' });
        setTimeout(() => setMessage(null), 4000);
      }
    }
  }, [user?.db_user?.telegram_chat_id]);

  useEffect(() => {
    if (!isOpen || !isWaitingForLink) return;

    const interval = setInterval(async () => {
      try {
        await refreshUser();
      } catch {
        // ignore
      }
    }, 2000);

    const timeout = setTimeout(() => {
      setIsWaitingForLink(false);
    }, 60000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isOpen, isWaitingForLink, refreshUser]);

  const [userAiKeyInfo, setUserAiKeyInfo] = useState<UserAiKeyResponse | null>(null);
  const [userAiKeyInput, setUserAiKeyInput] = useState('');
  const [showUserAiKey, setShowUserAiKey] = useState(false);
  const [isTestingUserKey, setIsTestingUserKey] = useState(false);
  const [isSavingUserKey, setIsSavingUserKey] = useState(false);
  const [userKeyTestResult, setUserKeyTestResult] = useState<{ valid: boolean; model?: string; error?: string | null } | null>(null);

  useEffect(() => {
    if (isOpen) {
      aiKeyService.getUserAiKey()
        .then(res => setUserAiKeyInfo(res))
        .catch(() => setUserAiKeyInfo(null));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestUserAiKey = async () => {
    const key = userAiKeyInput.trim();
    if (!key) return;
    setIsTestingUserKey(true);
    setUserKeyTestResult(null);
    try {
      const res = await aiKeyService.testApiKey(key);
      setUserKeyTestResult(res);
    } catch (e: any) {
      setUserKeyTestResult({ valid: false, error: e.message || 'Key test failed' });
    } finally {
      setIsTestingUserKey(false);
    }
  };

  const handleSaveUserAiKey = async () => {
    const key = userAiKeyInput.trim();
    if (!key) return;
    setIsSavingUserKey(true);
    try {
      const res = await aiKeyService.saveUserAiKey(key, true);
      setUserAiKeyInfo(res);
      setUserAiKeyInput('');
      setUserKeyTestResult(null);
      setShowUserAiKey(false);
      setMessage({ type: 'success', text: 'Personal AI key verified and saved!' });
      setTimeout(() => setMessage(null), 3000);
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to save personal AI key.' });
    } finally {
      setIsSavingUserKey(false);
    }
  };

  const handleRemoveUserAiKey = async () => {
    try {
      await aiKeyService.deleteUserAiKey();
      setUserAiKeyInfo({ user_id: '', has_custom_key: false, masked_key: null });
      setUserAiKeyInput('');
      setUserKeyTestResult(null);
      setMessage({ type: 'success', text: 'Personal AI key removed. Reverted to system key.' });
      setTimeout(() => setMessage(null), 3000);
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to remove AI key.' });
    }
  };

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

  const handleUnlink = async () => {
    if (!user?.db_user?.id) return;
    setIsSaving(true);
    try {
      await updateTelegramChatId(user.db_user.id, '');
      setChatId('');
      await refreshUser();
      setMessage({ type: 'success', text: 'Telegram unlinked successfully.' });
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to unlink Telegram.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs select-none animate-in fade-in duration-150">
      <div
        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border flex justify-between items-center bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Shield size={20} />
            </div>
            <div>
              <h2 className="text-foreground text-base font-semibold">Account Settings</h2>
              <p className="text-muted-foreground text-xs">Profile & Dispatch Channels</p>
            </div>
          </div>
          <CloseButton onClick={onClose} size="md" />
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* User Info Section */}
          <section>
            <h4 className="text-foreground text-xs font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <User size={13} className="text-primary" /> 
              <span>Profile</span>
            </h4>
            <div className="bg-muted/30 border border-border rounded-xl p-3.5 flex items-center gap-3.5 shadow-xs">
              <img src={user?.avatar_url} alt="Avatar" className="w-11 h-11 rounded-full border border-border object-cover" />
              <div className="min-w-0">
                <h3 className="text-foreground font-semibold text-sm truncate">{user?.name || user?.login}</h3>
                <p className="text-muted-foreground text-xs truncate mt-0.5">{user?.email || 'No email configured'}</p>
              </div>
            </div>
          </section>

          {/* Theme Section */}
          <section>
            <h4 className="text-foreground text-xs font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <Sun size={13} className="text-primary" />
              <span>Interface Theme</span>
            </h4>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={cn(
                  "p-3 rounded-lg border flex items-center justify-center gap-2 text-xs font-medium transition-colors cursor-pointer shadow-xs",
                  theme === 'dark'
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground border-border hover:bg-muted"
                )}
              >
                <Moon size={14} /> Dark Mode
              </button>
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={cn(
                  "p-3 rounded-lg border flex items-center justify-center gap-2 text-xs font-medium transition-colors cursor-pointer shadow-xs",
                  theme === 'light'
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground border-border hover:bg-muted"
                )}
              >
                <Sun size={14} /> Light Mode
              </button>
            </div>
          </section>

          {/* Telegram Section */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-foreground text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                <Bell size={13} className="text-primary" />
                <span>Telegram Dispatch</span>
              </h4>
              {user?.db_user?.telegram_chat_id ? (
                <Badge variant="success" className="text-[10px]">
                  <CheckCircle2 size={11} /> Connected
                </Badge>
              ) : (
                <Badge variant="warning" className="text-[10px]">
                  Not Connected
                </Badge>
              )}
            </div>

            <div className="space-y-3">
              <a
                href={user?.db_user?.id ? `https://t.me/OffsideOpenTaskBot?start=link_${user.db_user.id}` : (user?.login ? `https://t.me/OffsideOpenTaskBot?start=link_${user.login}` : 'https://t.me/OffsideOpenTaskBot')}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsWaitingForLink(true)}
                className={cn(
                  "flex items-center justify-between p-3.5 border rounded-xl transition-all cursor-pointer shadow-xs",
                  user?.db_user?.telegram_chat_id 
                    ? "bg-muted/30 border-border hover:bg-muted/50 text-foreground" 
                    : "bg-primary text-primary-foreground border-primary hover:opacity-90"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-background/20 flex items-center justify-center shrink-0">
                    <Send size={15} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold block">
                      {user?.db_user?.telegram_chat_id ? 'Open Bot Chat' : 'Auto-Link via Telegram'}
                    </span>
                    <span className="text-[11px] opacity-80">
                      {user?.db_user?.telegram_chat_id ? '@OffsideOpenTaskBot (Active)' : 'Tap to open bot & auto-connect'}
                    </span>
                  </div>
                </div>
                <ExternalLink size={14} className="shrink-0 opacity-80" />
              </a>

              {isWaitingForLink && !user?.db_user?.telegram_chat_id && (
                <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary animate-ping shrink-0" />
                  <p className="text-primary text-xs leading-tight">
                    Waiting for bot confirmation… Please tap <span className="font-semibold underline">START</span> in Telegram.
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-muted-foreground text-xs font-medium">
                    Chat ID (Manual edit)
                  </label>
                  {user?.db_user?.telegram_chat_id && (
                    <button
                      type="button"
                      onClick={handleUnlink}
                      className="text-destructive hover:underline text-[11px] font-medium cursor-pointer"
                    >
                      Unlink Account
                    </button>
                  )}
                </div>
                <div className="relative group">
                  <input
                    type="text"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="Enter Telegram Chat ID"
                    className="w-full bg-background border border-input rounded-lg py-2 px-3 text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-ring transition-colors shadow-xs"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Send size={14} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Personal AI Key Section */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-foreground text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                <Sparkles size={13} className="text-primary" />
                <span>Personal AI Key</span>
              </h4>
              {userAiKeyInfo?.has_custom_key ? (
                <Badge variant="success" className="text-[10px]">Active</Badge>
              ) : (
                <Badge variant="neutral" className="text-[10px]">System Key</Badge>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Provide your Google Gemini API key to use your personal quotas and token limits across all projects you interact with.
              </p>

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Google AI Studio</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                >
                  <span>Get Free Key</span>
                  <ExternalLink size={11} />
                </a>
              </div>

              {userAiKeyInfo?.has_custom_key && (
                <div className="p-3 bg-muted/30 border border-border rounded-xl flex items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1 rounded-md bg-emerald-500/15 text-emerald-500 shrink-0">
                      <CheckCircle2 size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground">Current key</div>
                      <div className="text-xs font-mono font-medium text-foreground tracking-wider truncate">{userAiKeyInfo.masked_key}</div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={handleRemoveUserAiKey}
                  >
                    Remove
                  </Button>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showUserAiKey ? "text" : "password"}
                      value={userAiKeyInput}
                      onChange={(e) => {
                        setUserAiKeyInput(e.target.value);
                        setUserKeyTestResult(null);
                      }}
                      placeholder={userAiKeyInfo?.has_custom_key ? "Replace key (AIzaSy...)" : "Enter key (AIzaSy...)"}
                      className="w-full bg-background border border-input rounded-lg py-2 px-3 text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowUserAiKey(!showUserAiKey)}
                    title={showUserAiKey ? "Hide key" : "Reveal key"}
                  >
                    {showUserAiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTestUserAiKey}
                    disabled={isTestingUserKey || !userAiKeyInput.trim()}
                  >
                    {isTestingUserKey ? "Testing…" : "Test"}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleSaveUserAiKey}
                    disabled={isSavingUserKey || !userAiKeyInput.trim()}
                  >
                    {isSavingUserKey ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>

              {userKeyTestResult && (
                <div
                  className={cn(
                    "p-2.5 rounded-lg border text-xs flex items-center gap-2 font-medium shadow-xs",
                    userKeyTestResult.valid
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      : "bg-destructive/15 text-destructive border-destructive/30"
                  )}
                >
                  {userKeyTestResult.valid ? (
                    <>
                      <CheckCircle2 size={14} />
                      <span>Key valid! Verified with {userKeyTestResult.model?.toUpperCase()}</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={14} />
                      <span>Error: {userKeyTestResult.error || "Invalid key"}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Desktop Application Section */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-foreground text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                <Monitor size={14} className="text-primary" />
                <span>Desktop Platform & Updates</span>
              </h4>
              <Badge variant="primary" className="text-[10px]">
                {currentVersion || "Web"}
              </Badge>
            </div>

            <div className="p-3.5 bg-muted/30 border border-border rounded-xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-foreground text-xs font-semibold mb-0.5">
                  Tauri Desktop Platform
                </div>
                <div className="text-muted-foreground text-[11px]">
                  {currentVersion && currentVersion !== "web"
                    ? `Installed desktop binary: ${currentVersion}`
                    : "Running in web browser runtime"}
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => checkForUpdates(false)}
                disabled={isCheckingUpdates}
              >
                <RefreshCw size={12} className={isCheckingUpdates ? "animate-spin" : ""} />
                <span>{isCheckingUpdates ? "Checking…" : "Check for updates"}</span>
              </Button>
            </div>
          </section>

          {message && (
            <div className={cn(
              "p-3 rounded-lg text-xs font-medium border shadow-xs",
              message.type === 'success'
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : "bg-destructive/15 text-destructive border-destructive/30"
            )}>
              {message.text}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-muted/30 border-t border-border flex justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
};
