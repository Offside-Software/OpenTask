import React, { useState, useEffect } from 'react';
import { Github, Search, Plus, Check, X, ExternalLink } from 'lucide-react';
import { searchGithubRepositories, getGithubAppInstallUrl } from '../../services/githubServices';
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
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 select-none" onClick={onClose}>
            <div
                className="bg-[#121417] border-2 border-black rounded-none w-full max-w-3xl shadow-[8px_8px_0px_0px_#000000] flex flex-col max-h-[85vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b-2 border-black bg-[#181B20]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#FFE600] border-2 border-black rounded-none shadow-[2px_2px_0px_0px_#000000]">
                            <Github size={16} strokeWidth={2.5} className="text-black" />
                        </div>
                        <div>
                            <h2 className="text-white font-mono font-black text-[14px] uppercase tracking-wider">
                                // CONNECT REPOSITORIES
                            </h2>
                            <p className="text-neutral-500 font-mono text-[11px] uppercase mt-0.5">
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
                                className="flex items-center gap-1 px-2.5 py-1 bg-black text-[#FFE600] border border-neutral-700 hover:border-[#FFE600] font-mono text-[11px] font-black uppercase tracking-wider transition-all shadow-[1.5px_1.5px_0px_0px_#000000]"
                                title="Install GitHub App on your account or organization"
                            >
                                <Plus size={11} strokeWidth={3} /> Install on GitHub
                                <ExternalLink size={10} />
                            </a>
                        )}
                        <CloseButton onClick={onClose} size="md" />
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5 font-mono">
                    {/* Search */}
                    <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-neutral-400 mb-1.5">
                            // SEARCH GITHUB REPOSITORIES
                        </label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                <Search size={13} className="text-neutral-500" />
                            </div>
                            <input
                                type="text"
                                placeholder="SEARCH REPOS (MIN 2 CHARS)..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full bg-[#0B0E14] border-2 border-black rounded-none pl-8 pr-4 py-2.5 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:border-[#FFE600] focus:outline-none shadow-[2px_2px_0px_0px_#000000]"
                            />
                            {isSearching && (
                                <div className="absolute inset-y-0 right-3 flex items-center">
                                    <div className="w-4 h-4 rounded-none border-2 border-black border-t-[#FFE600] animate-spin" />
                                </div>
                            )}
                        </div>

                        {searchResults.length > 0 && (
                            <div className="mt-2 border-2 border-black bg-[#0B0E14] max-h-48 overflow-y-auto shadow-[4px_4px_0px_0px_#000000]">
                                {searchResults.map(r => {
                                    const isSelected = selected.includes(r.html_url);
                                    return (
                                        <button
                                            key={r.html_url}
                                            type="button"
                                            onClick={() => toggleRepo(r.html_url)}
                                            className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors border-b border-neutral-800 last:border-0 cursor-pointer ${
                                                isSelected
                                                    ? 'bg-[#FFE600] text-black'
                                                    : 'hover:bg-[#1E2227] text-white'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Github size={12} strokeWidth={2} className={isSelected ? 'text-black' : 'text-neutral-400'} />
                                                <span className="text-[12px] font-bold uppercase truncate">{r.full_name}</span>
                                                {r.private && (
                                                    <span className={`text-[11px] px-1 border font-bold uppercase ${isSelected ? 'border-black text-black' : 'border-neutral-600 text-neutral-500'}`}>
                                                        PRIVATE
                                                    </span>
                                                )}
                                            </div>
                                            {isSelected && <Check size={14} strokeWidth={3} className="text-black shrink-0" />}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Manual URL entry */}
                    <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-neutral-400 mb-1.5">
                            // ENTER URL MANUALLY
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="https://github.com/org/repo"
                                value={manualUrl}
                                onChange={e => setManualUrl(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddManual(); } }}
                                className="flex-1 bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2.5 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:border-[#FFE600] focus:outline-none shadow-[2px_2px_0px_0px_#000000]"
                            />
                            <button
                                type="button"
                                onClick={handleAddManual}
                                disabled={!manualUrl.trim()}
                                className="flex items-center gap-1.5 px-3 py-2 bg-[#FFE600] text-black border-2 border-black rounded-none text-[11px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000000] disabled:opacity-50 transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                            >
                                <Plus size={13} strokeWidth={3} /> ADD
                            </button>
                        </div>
                    </div>

                    {/* Currently selected */}
                    {selected.length > 0 && (
                        <div>
                            <label className="block text-[11px] font-black uppercase tracking-wider text-neutral-400 mb-2">
                                // SELECTED ({selected.length})
                            </label>
                            <div className="space-y-1.5">
                                {selected.map(url => {
                                    const name = url.replace('https://github.com/', '');
                                    return (
                                        <div key={url} className="flex items-center justify-between px-3 py-2 bg-[#0B0E14] border-2 border-[#FFE600] rounded-none shadow-[2px_2px_0px_0px_#FFE600]">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Github size={11} className="text-[#FFE600] shrink-0" />
                                                <span className="text-[12px] font-bold text-white truncate">{name}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleRepo(url)}
                                                className="text-neutral-500 hover:text-[#EF4444] transition-colors cursor-pointer shrink-0 ml-2"
                                            >
                                                <X size={13} strokeWidth={2.5} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {/* Local Webhook Forwarding Note */}
                    <div className="p-3 bg-[#0B0E14] border-2 border-neutral-800 rounded-none font-mono text-[11px] text-neutral-400 space-y-1">
                        <div className="flex items-center gap-1.5 text-[#FFE600] font-black uppercase">
                            <span>⚡ Real-Time Webhook Setup (Localhost):</span>
                        </div>
                        <p>
                            To receive GitHub&apos;s real-time events on localhost, forward webhooks via Smee or ngrok:
                        </p>
                        <div className="bg-black p-4 border border-neutral-800 text-neutral-300 font-mono text-[11px] select-all">
                            npx smee -u &lt;your-smee-channel-url&gt; -t http://localhost:8000/github/webhook
                        </div>
                        <p className="text-neutral-500">
                            Or click <strong className="text-neutral-300">[SYNC &amp; REVIEW PRS]</strong> on the Kanban board to immediately review PRs anytime!
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t-2 border-black flex justify-end gap-3 bg-[#0E1012]">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-none border-2 border-black bg-[#1E2227] text-neutral-300 font-mono text-[12px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000] hover:bg-white hover:text-black transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        className="px-6 py-2.5 rounded-none border-2 border-black bg-[#FFE600] text-black font-mono text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] transition-all cursor-pointer active:translate-x-[1px] active:translate-y-[1px]"
                    >
                        CONFIRM SELECTION
                    </button>
                </div>
            </div>
        </div>
    );
};
