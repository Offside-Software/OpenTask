import React, { useState, useEffect } from 'react';
import { Github, Search, Plus, Check, X, ExternalLink } from 'lucide-react';
import { searchGithubRepositories, getGithubAppInstallUrl } from '../../services/githubServices';
import { Button } from '../../design-system/Button';
import { CloseButton } from '../../design-system/CloseButton';

interface RepositoryPickerModalProps {
    projectId: string | number;
    currentRepoUrls: string[];
    onClose: () => void;
    onReposUpdated: (newUrls: string[]) => void;
}

export const RepositoryPickerModal: React.FC<RepositoryPickerModalProps> = ({
    currentRepoUrls,
    onClose,
    onReposUpdated,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<{ full_name: string; html_url: string; private: boolean }[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selected, setSelected] = useState<string[]>([...currentRepoUrls]);
    const [manualUrl, setManualUrl] = useState('');
    const [installUrl, setInstallUrl] = useState<string | null>(null);

    useEffect(() => {
        getGithubAppInstallUrl()
            .then(url => setInstallUrl(url))
            .catch(() => setInstallUrl('https://github.com/settings/apps'));
    }, []);

    useEffect(() => {
        const delay = setTimeout(async () => {
            const q = searchQuery.trim();
            if (q.length >= 2) {
                setIsSearching(true);
                try {
                    const results = await searchGithubRepositories(q);
                    setSearchResults(results);
                } catch {
                    setSearchResults([]);
                } finally {
                    setIsSearching(false);
                }
            } else {
                setSearchResults([]);
            }
        }, 350);
        return () => clearTimeout(delay);
    }, [searchQuery]);

    const toggleRepo = (url: string) => {
        setSelected(prev =>
            prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]
        );
    };

    const handleAddManual = () => {
        const url = manualUrl.trim();
        if (!url) return;
        const normalised = url.startsWith('https://') ? url : `https://github.com/${url}`;
        if (!selected.includes(normalised)) {
            setSelected(prev => [...prev, normalised]);
        }
        setManualUrl('');
    };

    const handleConfirm = () => {
        onReposUpdated(selected);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 select-none animate-in fade-in duration-100">
            <div
                className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-3xl shadow-xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-100"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-border bg-card">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary border border-primary/20 rounded-lg">
                            <Github size={18} />
                        </div>
                        <div>
                            <h2 className="text-foreground font-semibold text-base">
                                Connect Repositories
                            </h2>
                            <p className="text-muted-foreground text-xs mt-0.5">
                                Search or enter GitHub repo URLs
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {installUrl && (
                            <a
                                href={installUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border text-xs font-medium transition-colors"
                                title="Install GitHub App on your account or organization"
                            >
                                <Plus size={13} />
                                <span>Install on GitHub</span>
                                <ExternalLink size={11} className="text-muted-foreground" />
                            </a>
                        )}
                        <CloseButton onClick={onClose} size="md" />
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    {/* Search */}
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Search GitHub Repositories
                        </label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                <Search size={14} className="text-muted-foreground" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search repos (min 2 chars)..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full bg-background border border-input rounded-md pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-none transition-colors"
                            />
                            {isSearching && (
                                <div className="absolute inset-y-0 right-3 flex items-center">
                                    <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                                </div>
                            )}
                        </div>

                        {searchResults.length > 0 && (
                            <div className="mt-2 border border-border rounded-lg bg-card max-h-48 overflow-y-auto divide-y divide-border shadow-sm">
                                {searchResults.map(r => {
                                    const isSelected = selected.includes(r.html_url);
                                    return (
                                        <button
                                            key={r.html_url}
                                            type="button"
                                            onClick={() => toggleRepo(r.html_url)}
                                            className={`w-full flex items-center justify-between px-3.5 py-2 text-left transition-colors cursor-pointer ${
                                                isSelected
                                                    ? 'bg-primary/10 text-primary font-medium'
                                                    : 'hover:bg-muted/50 text-foreground'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Github size={13} className={isSelected ? 'text-primary' : 'text-muted-foreground'} />
                                                <span className="text-xs truncate">{r.full_name}</span>
                                                {r.private && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                                                        Private
                                                    </span>
                                                )}
                                            </div>
                                            {isSelected && <Check size={14} className="text-primary shrink-0" />}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Manual URL entry */}
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Enter URL Manually
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="https://github.com/org/repo"
                                value={manualUrl}
                                onChange={e => setManualUrl(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddManual(); } }}
                                className="flex-1 bg-background border border-input rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-none"
                            />
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                onClick={handleAddManual}
                                disabled={!manualUrl.trim()}
                            >
                                <Plus size={13} />
                                <span>Add</span>
                            </Button>
                        </div>
                    </div>

                    {/* Currently selected */}
                    {selected.length > 0 && (
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-2">
                                Selected Repositories ({selected.length})
                            </label>
                            <div className="space-y-1.5">
                                {selected.map(url => {
                                    const name = url.replace('https://github.com/', '');
                                    return (
                                        <div key={url} className="flex items-center justify-between px-3 py-2 bg-muted/40 border border-border rounded-lg">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Github size={13} className="text-primary shrink-0" />
                                                <span className="text-xs font-medium text-foreground truncate">{name}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleRepo(url)}
                                                className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer shrink-0 ml-2"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Local Webhook Forwarding Note */}
                    <div className="p-3.5 bg-muted/30 border border-border rounded-lg text-xs text-muted-foreground space-y-1.5">
                        <div className="flex items-center gap-1.5 text-foreground font-medium">
                            <span>Real-Time Webhook Setup (Localhost):</span>
                        </div>
                        <p>
                            To receive GitHub&apos;s real-time events on localhost, forward webhooks via Smee or ngrok:
                        </p>
                        <div className="bg-background p-2.5 rounded-md border border-border text-foreground font-mono text-[11px] select-text">
                            npx smee -u &lt;your-smee-channel-url&gt; -t http://localhost:8000/github/webhook
                        </div>
                        <p className="text-muted-foreground text-[11px]">
                            Or click <strong className="text-foreground">[Sync &amp; Review PRs]</strong> on the Kanban board to immediately review PRs anytime!
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border flex justify-end gap-3 bg-card">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        onClick={handleConfirm}
                    >
                        Confirm Selection
                    </Button>
                </div>
            </div>
        </div>
    );
};
