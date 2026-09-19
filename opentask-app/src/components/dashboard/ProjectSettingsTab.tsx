import React, { useState, useEffect } from 'react';
import { SurfaceCard } from '../../design-system/SurfaceCard';
import { Badge } from '../../design-system/Badge';
import { Settings, Users, Plus, Search, Save, X, AlertTriangle, Github, GitBranch, Trash2, ExternalLink, Bot, Key, Copy, Check, Eye, EyeOff, Terminal, Sparkles, CheckCircle2 } from 'lucide-react';
import { projectService } from '../../services/projectService';
import { projectMemberService } from '../../services/projectMemberService';
import { userService } from '../../services/userService';
import { searchGithubUsers } from '../../services/githubServices';
import { aiKeyService, type ProjectAiKeyResponse } from '../../services/aiKeyService';
import { useToast } from '../../design-system/Toast';
import { ConfirmModal } from '../modals/ConfirmModal';
import { LoadingScreen } from '../ui/LoadingScreen';
import { RepositoryPickerModal } from '../modals/RepositoryPickerModal';
import { useNavigate } from 'react-router-dom';
import { getCached, setCached } from '../../utils/cache';
import type { Project, ProjectMember } from '../../models';

interface ProjectSettingsTabProps {
    projectId: string | number;
    onProjectUpdated?: (project: Project) => void;
}

// Hard-coded list of roles (no longer stored in the DB projects table).
const DEFAULT_ROLES = ['Owner', 'Manager', 'Programmer', 'Designer', 'QA'];

export const ProjectSettingsTab: React.FC<ProjectSettingsTabProps> = ({ projectId, onProjectUpdated }) => {
    const navigate = useNavigate();
    const [project, setProject] = useState<Project | null>(null);
    const [members, setMembers] = useState<ProjectMember[]>([]);
    const [memberFilter, setMemberFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const { showToast } = useToast();

    // AI Agent Access API Key State
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [apiKeyLoading, setApiKeyLoading] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);
    const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);

    // Custom Integrated AI (Gemini Key) State
    const [customAiKeyInfo, setCustomAiKeyInfo] = useState<ProjectAiKeyResponse | null>(null);
    const [customAiInput, setCustomAiInput] = useState('');
    const [showCustomAiKey, setShowCustomAiKey] = useState(false);
    const [aiKeyTesting, setAiKeyTesting] = useState(false);
    const [aiKeySaving, setAiKeySaving] = useState(false);
    const [aiKeyTestResult, setAiKeyTestResult] = useState<{ valid: boolean; model?: string; error?: string | null } | null>(null);
    const [isRemoveProjectAiKeyModalOpen, setIsRemoveProjectAiKeyModalOpen] = useState(false);

    // Project Edit State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    // Repository State
    const [isRepoPicker, setIsRepoPicker] = useState(false);
    const [repoUrls, setRepoUrls] = useState<string[]>([]);


    // Add Member State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<{ id?: number | string; gh_username: string; display_name?: string }[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedUser, setSelectedUser] = useState<{ id?: number | string; gh_username: string } | null>(null);
    const [selectedRole, setSelectedRole] = useState('');

    const loadData = async () => {
        setLoading(true);
        try {
            const [p, m, keyData, customKeyData] = await Promise.all([
                projectService.getProjectById(projectId),
                projectMemberService.getMembers(projectId),
                projectService.getProjectApiKey(projectId).catch(() => ({ api_key: null })),
                aiKeyService.getProjectAiKey(projectId).catch(() => null),
            ]);
            setProject(p);
            setName(p.name || '');
            setDescription(p.description || '');
            setRepoUrls(p.gh_repo_url || []);
            setMembers(m);
            setApiKey(keyData?.api_key || null);
            setCustomAiKeyInfo(customKeyData);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleTestCustomAiKey = async () => {
        const keyToTest = customAiInput.trim();
        if (!keyToTest) {
            showToast("Please enter an API key to test", "warning");
            return;
        }
        setAiKeyTesting(true);
        setAiKeyTestResult(null);
        try {
            const res = await aiKeyService.testApiKey(keyToTest);
            setAiKeyTestResult(res);
            if (res.valid) {
                showToast(`API Key verified successfully! Model: ${res.model}`, "success");
            } else {
                showToast(res.error || "API Key verification failed", "error");
            }
        } catch (e: any) {
            const errMsg = e.message || "Failed to test API key";
            setAiKeyTestResult({ valid: false, error: errMsg });
            showToast(errMsg, "error");
        } finally {
            setAiKeyTesting(false);
        }
    };

    const handleSaveCustomAiKey = async () => {
        const keyToSave = customAiInput.trim();
        if (!keyToSave) {
            showToast("Please enter an API key to save", "warning");
            return;
        }
        setAiKeySaving(true);
        try {
            const res = await aiKeyService.saveProjectAiKey(projectId, keyToSave, true);
            setCustomAiKeyInfo(res);
            setCustomAiInput('');
            setAiKeyTestResult(null);
            setShowCustomAiKey(false);
            showToast("Project Custom AI key saved and verified successfully!", "success");
        } catch (e: any) {
            showToast(e.message || "Failed to save API key", "error");
        } finally {
            setAiKeySaving(false);
        }
    };

    const handleRemoveCustomAiKey = async () => {
        setIsRemoveProjectAiKeyModalOpen(false);
        try {
            await aiKeyService.deleteProjectAiKey(projectId);
            setCustomAiKeyInfo({ project_id: String(projectId), has_custom_key: false, masked_key: null });
            setCustomAiInput('');
            setAiKeyTestResult(null);
            showToast("Custom AI key removed. Reverted to system default key.", "info");
        } catch (e: any) {
            showToast(e.message || "Failed to remove custom AI key", "error");
        }
    };

    const handleGenerateApiKey = async () => {
        setApiKeyLoading(true);
        try {
            const res = await projectService.generateProjectApiKey(projectId);
            setApiKey(res.api_key);
            setShowApiKey(true);
            showToast("Project API key generated successfully", "success");
        } catch (e) {
            console.error(e);
            showToast("Failed to generate project API key", "error");
        } finally {
            setApiKeyLoading(false);
        }
    };

    const handleRevokeApiKey = async () => {
        setIsRevokeModalOpen(false);
        setApiKeyLoading(true);
        try {
            await projectService.revokeProjectApiKey(projectId);
            setApiKey(null);
            setShowApiKey(false);
            showToast("Project API key revoked", "info");
        } catch (e) {
            console.error(e);
            showToast("Failed to revoke API key", "error");
        } finally {
            setApiKeyLoading(false);
        }
    };

    const handleCopyApiKey = async () => {
        if (!apiKey) return;
        try {
            await navigator.clipboard.writeText(apiKey);
            setCopiedKey(true);
            showToast("API key copied to clipboard", "success");
            setTimeout(() => setCopiedKey(false), 2000);
        } catch {
            showToast("Failed to copy API key", "error");
        }
    };

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);

    const handleUpdateProject = async () => {
        if (!project) return;
        try {
            const updated = await projectService.updateProject(projectId, {
                ...project,
                name,
                description,
            });
            setProject(updated);

            // Notify parent page so the header title updates without reload
            onProjectUpdated?.(updated);

            // Patch every user-scoped project cache key that might exist
            // (we don't know userId here, so we patch all matching keys in localStorage)
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('opentask_projects_')) {
                        const cached = getCached<Project[]>(key);
                        if (cached) {
                            const patched = cached.map((p) =>
                                String(p.id) === String(updated.id) ? { ...p, ...updated } : p,
                            );
                            setCached(key, patched);
                        }
                    }
                }
            } catch (_) { /* non-critical */ }

            showToast('Project updated successfully', 'success');
        } catch (e) {
            console.error(e);
            showToast('Failed to update project', 'error');
        }
    };

    const handleDeleteProject = async () => {
        setIsDeleteModalOpen(false);
        try {
            await projectService.deleteProject(projectId);
            showToast('Project deleted successfully', 'info');
            navigate('/workspaces');
        } catch (e) {
            console.error(e);
            showToast('Failed to delete project', 'error');
        }
    };

    const handleReposUpdated = async (newUrls: string[]) => {
        setRepoUrls(newUrls);
        if (!project) return;
        try {
            const updated = await projectService.updateProject(projectId, {
                ...project,
                name,
                description,
                gh_repo_url: newUrls,
            });
            setProject(updated);
            onProjectUpdated?.(updated);
            showToast('Repository connections updated', 'success');
        } catch (e) {
            console.error(e);
            showToast('Failed to save repository changes', 'error');
        }
    };

    const handleRemoveRepo = async (url: string) => {
        const newUrls = repoUrls.filter(u => u !== url);
        await handleReposUpdated(newUrls);
    };



    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            const q = searchQuery.trim();
            if (q.length >= 2) {
                setIsSearching(true);
                try {
                    const [localUsersRes, ghUsersRes] = await Promise.allSettled([
                        userService.searchUsers(q),
                        searchGithubUsers(q),
                    ]);

                    const results: { id?: number | string; gh_username: string; display_name?: string }[] = [];
                    const seen = new Set<string>();

                    if (localUsersRes.status === 'fulfilled') {
                        for (const u of localUsersRes.value) {
                            const uname = (u.gh_username || u.display_name || '').toLowerCase();
                            if (uname && !seen.has(uname)) {
                                seen.add(uname);
                                results.push({
                                    id: u.id,
                                    gh_username: u.gh_username || u.display_name || `User #${u.id}`,
                                    display_name: u.display_name,
                                });
                            }
                        }
                    }

                    if (ghUsersRes.status === 'fulfilled') {
                        for (const g of ghUsersRes.value) {
                            const uname = g.login.toLowerCase();
                            if (!seen.has(uname)) {
                                seen.add(uname);
                                results.push({
                                    gh_username: g.login,
                                });
                            }
                        }
                    }

                    // Filter out users who are already members
                    const filtered = results.filter(
                        r =>
                            !members.some(
                                m =>
                                    (m.gh_username && m.gh_username.toLowerCase() === r.gh_username.toLowerCase()) ||
                                    (r.id && String(m.user_id) === String(r.id)),
                            ),
                    );
                    setSearchResults(filtered);
                } catch (e) {
                    console.error(e);
                } finally {
                    setIsSearching(false);
                }
            } else {
                setSearchResults([]);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [searchQuery, members]);

    const handleAddMember = async () => {
        if (!selectedUser || !selectedRole) return;
        try {
            await projectMemberService.createMember(projectId, {
                user_id: selectedUser.id ? (selectedUser.id as any) : undefined,
                gh_username: selectedUser.gh_username,
                role: selectedRole,
                max_capacity: 100,
                current_load: 0,
                kpi_score: 0,
            });
            await loadData();
            setSelectedUser(null);
            setSearchQuery('');
            setSelectedRole('');
            showToast('Member added successfully', 'success');
        } catch (e) {
            console.error(e);
            showToast('Failed to add member', 'error');
        }
    };

    if (loading) {
        return (
            <div className="w-full flex-1 flex items-center justify-center min-h-[calc(100vh-14rem)]">
                <LoadingScreen
                    fullscreen={false}
                    message="LOADING SETTINGS…"
                    subtext="// RETRIEVING PROJECT CONFIGURATION & PERMISSIONS"
                />
            </div>
        );
    }

    return (
        <div className="space-y-6 select-none font-mono">
            {/* General Settings */}
            <SurfaceCard title="Project Details" subtitle="Update basic project information" icon={Settings} rightElement={null}>
                <div className="space-y-4">
                    <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-neutral-400 mb-1.5">// PROJECT TITLE</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-4 py-2.5 text-[13px] font-mono text-white focus:border-[#FFE600] focus:outline-none shadow-[2px_2px_0px_0px_#000000]"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-neutral-400 mb-1.5">// DESCRIPTION</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-4 py-2.5 text-[13px] font-mono text-white focus:border-[#FFE600] focus:outline-none min-h-[100px] shadow-[2px_2px_0px_0px_#000000]"
                        />
                    </div>

                    <button
                        onClick={handleUpdateProject}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#FFE600] text-black border-2 border-black rounded-none text-[11px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer"
                    >
                        <Save size={14} strokeWidth={2.5} /> Save Changes
                    </button>
                </div>
            </SurfaceCard>

            {/* Connected Repositories */}
            <SurfaceCard title="Connected Repositories" subtitle={`${repoUrls.length} repo${repoUrls.length !== 1 ? 's' : ''} linked`} icon={GitBranch} rightElement={null}>
                <div className="space-y-4">
                    {repoUrls.length === 0 ? (
                        <div className="py-6 text-center border-2 border-dashed border-neutral-700 rounded-none">
                            <Github size={24} className="text-neutral-600 mx-auto mb-2" />
                            <p className="text-neutral-500 font-mono text-[11px] uppercase">// NO REPOSITORIES CONNECTED</p>
                            <p className="text-neutral-600 font-mono text-[10px] mt-1">Connect repos to enable AI code review</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {repoUrls.map((url) => {
                                const repoName = url.replace('https://github.com/', '');
                                const [orgName, repoShortName] = repoName.split('/');
                                return (
                                    <div key={url} className="flex items-center justify-between p-3 bg-[#121417] border-2 border-black rounded-none shadow-[2px_2px_0px_0px_#000000]">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="p-1.5 bg-[#FFE600] border-2 border-black rounded-none shadow-[1px_1px_0px_0px_#000000]">
                                                <Github size={12} strokeWidth={2.5} className="text-black" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[13px] font-bold text-white font-mono uppercase truncate">{repoShortName || repoName}</div>
                                                <div className="text-[12px] text-white font-mono">{orgName}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-neutral-500 hover:text-[#FFE600] transition-colors">
                                                <ExternalLink size={13} strokeWidth={2} />
                                            </a>
                                            <button
                                                onClick={() => handleRemoveRepo(url)}
                                                className="text-neutral-500 hover:text-[#EF4444] transition-colors cursor-pointer"
                                            >
                                                <Trash2 size={13} strokeWidth={2} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <button
                        onClick={() => setIsRepoPicker(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#FFE600] text-black border-2 border-black rounded-none text-[11px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer"
                    >
                        <Github size={13} strokeWidth={2.5} /> Connect Repository
                    </button>
                </div>
            </SurfaceCard>

            {/* Custom Integrated AI (BYOT Gemini Key) */}
            <SurfaceCard
                title="Custom Integrated AI"
                subtitle="BRING YOUR OWN GEMINI KEY FOR PR REVIEWS, MEETINGS & TASK EVALUATIONS"
                icon={Sparkles}
                rightElement={
                    customAiKeyInfo?.has_custom_key ? (
                        <Badge variant="success">
                            <CheckCircle2 size={11} className="mr-1 inline" /> CUSTOM TOKEN ACTIVE
                        </Badge>
                    ) : (
                        <Badge variant="default">
                            SYSTEM DEFAULT KEY
                        </Badge>
                    )
                }
            >
                <div className="space-y-5">
                    <p className="text-[12px] font-mono text-neutral-400 leading-relaxed">
                        Configure a custom Google Gemini API key for this project. When active, all internal AI operations (automated PR code reviews, meeting analysis, task estimation) will utilize your token and quotas instead of the shared system token.
                    </p>

                    {customAiKeyInfo?.has_custom_key && (
                        <div className="p-3.5 bg-[#121417] border-2 border-black rounded-none flex items-center justify-between gap-3 shadow-[2px_2px_0px_0px_#000000]">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="p-1.5 bg-[#00FF66] text-black border-2 border-black rounded-none shadow-[1px_1px_0px_0px_#000000]">
                                    <CheckCircle2 size={14} strokeWidth={2.5} />
                                </div>
                                <div className="min-w-0 font-mono">
                                    <div className="text-[10px] font-black uppercase text-neutral-400">// ACTIVE PROJECT KEY</div>
                                    <div className="text-[13px] font-bold text-white tracking-widest truncate">{customAiKeyInfo.masked_key}</div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsRemoveProjectAiKeyModalOpen(true)}
                                className="px-3 py-1.5 bg-[#1E2227] hover:bg-[#FF3333] hover:text-white text-[#FF6666] border-2 border-black rounded-none font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all active:translate-x-[1px] active:translate-y-[1px] shrink-0"
                            >
                                <Trash2 size={12} />
                                <span>REMOVE</span>
                            </button>
                        </div>
                    )}

                    <div className="space-y-3">
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-[11px] font-bold uppercase text-neutral-400 font-mono">
                                    // {customAiKeyInfo?.has_custom_key ? "REPLACE GEMINI API KEY" : "ENTER GOOGLE GEMINI API KEY"}
                                </label>
                                <a
                                    href="https://aistudio.google.com/app/apikey"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-[#FFE600] hover:underline"
                                >
                                    <span>GET FREE KEY (AI STUDIO)</span>
                                    <ExternalLink size={11} />
                                </a>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                <div className="relative flex-1 min-w-[280px]">
                                    <input
                                        type={showCustomAiKey ? "text" : "password"}
                                        value={customAiInput}
                                        onChange={(e) => {
                                            setCustomAiInput(e.target.value);
                                            setAiKeyTestResult(null);
                                        }}
                                        placeholder={customAiKeyInfo?.has_custom_key ? "Enter new API key (AIzaSy...)" : "AIzaSy..."}
                                        className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3.5 py-2.5 text-[13px] font-mono text-white tracking-wider focus:border-[#FFE600] focus:outline-none shadow-[2px_2px_0px_0px_#000000]"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowCustomAiKey(!showCustomAiKey)}
                                    className="px-3.5 py-2.5 bg-[#141619] hover:bg-neutral-800 text-neutral-300 border-2 border-black rounded-none font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all active:translate-x-[1px] active:translate-y-[1px]"
                                    title={showCustomAiKey ? "Hide Key" : "Reveal Key"}
                                >
                                    {showCustomAiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                    <span>{showCustomAiKey ? "HIDE" : "REVEAL"}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleTestCustomAiKey}
                                    disabled={aiKeyTesting || !customAiInput.trim()}
                                    className="px-4 py-2.5 bg-[#1E2227] hover:bg-white hover:text-black text-neutral-200 border-2 border-black rounded-none font-mono text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all disabled:opacity-50 active:translate-x-[1px] active:translate-y-[1px] shrink-0"
                                >
                                    <Bot size={14} />
                                    <span>{aiKeyTesting ? "TESTING..." : "TEST KEY"}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveCustomAiKey}
                                    disabled={aiKeySaving || !customAiInput.trim()}
                                    className="px-4 py-2.5 bg-[#FFE600] hover:bg-[#FFF066] text-black border-2 border-black rounded-none font-mono text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all disabled:opacity-50 active:translate-x-[1px] active:translate-y-[1px] shrink-0"
                                >
                                    <Save size={14} strokeWidth={2.5} />
                                    <span>{aiKeySaving ? "SAVING..." : "SAVE KEY"}</span>
                                </button>
                            </div>
                        </div>

                        {/* Test Feedback banner */}
                        {aiKeyTestResult && (
                            <div
                                className={`p-3 border-2 border-black rounded-none font-mono text-[11px] flex items-center gap-2 shadow-[2px_2px_0px_0px_#000000] ${
                                    aiKeyTestResult.valid
                                        ? "bg-[#00FF66] text-black font-bold"
                                        : "bg-[#FF3333] text-white font-bold"
                                }`}
                            >
                                {aiKeyTestResult.valid ? (
                                    <>
                                        <CheckCircle2 size={15} strokeWidth={2.5} />
                                        <span>KEY VALID & READY! PING VERIFIED WITH MODEL: {aiKeyTestResult.model?.toUpperCase()}</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle size={15} strokeWidth={2.5} />
                                        <span>VALIDATION ERROR: {aiKeyTestResult.error || "INVALID KEY"}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </SurfaceCard>

            {/* AI Native Agent Access Card */}
            <SurfaceCard 
                title="AI Agent Access" 
                subtitle="PROGRAMMATIC API FOR CODE AGENTS (CURSOR, ANTIGRAVITY, CLAUDE, AIDER)" 
                icon={Bot} 
                rightElement={
                    apiKey && (
                        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#00FF66] text-black border-2 border-black font-mono text-[10px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000]">
                            <span className="w-2 h-2 bg-black rounded-full animate-pulse"></span>
                            ACTIVE
                        </span>
                    )
                }
            >
                <div className="space-y-5">
                    <p className="text-[12px] font-mono text-neutral-400 leading-relaxed">
                        Authorize external AI coding agents to interact directly with this project. Agents can look up tasks using copied IDs, mark tasks complete, move tasks between pipeline stages, and fetch project status summaries.
                    </p>

                    {apiKey ? (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold uppercase text-neutral-400 mb-1.5 font-mono">
                                    // PROJECT API KEY (SECRET)
                                </label>
                                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                    <div className="relative flex-1 min-w-[280px]">
                                        <input
                                            type={showApiKey ? "text" : "password"}
                                            readOnly
                                            value={apiKey}
                                            className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3.5 py-2.5 text-[13px] font-mono text-[#FFE600] tracking-wider focus:outline-none shadow-[2px_2px_0px_0px_#000000] select-all"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                        className="px-3.5 py-2.5 bg-[#141619] hover:bg-neutral-800 text-neutral-300 border-2 border-black rounded-none font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all active:translate-x-[1px] active:translate-y-[1px]"
                                        title={showApiKey ? "Hide Key" : "Reveal Key"}
                                    >
                                        {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                                        <span>{showApiKey ? "HIDE" : "REVEAL"}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCopyApiKey}
                                        className="px-4 py-2.5 bg-[#FFE600] text-black border-2 border-black rounded-none font-mono text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_0px_#000000] cursor-pointer transition-all active:translate-x-[1px] active:translate-y-[1px]"
                                    >
                                        {copiedKey ? <Check size={14} strokeWidth={3} /> : <Copy size={14} />}
                                        <span>{copiedKey ? "COPIED!" : "COPY KEY"}</span>
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 pt-1 flex-wrap">
                                <button
                                    type="button"
                                    onClick={handleGenerateApiKey}
                                    disabled={apiKeyLoading}
                                    className="px-4 py-2 bg-[#1E2227] hover:bg-white hover:text-black text-neutral-300 border-2 border-black rounded-none font-mono text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all disabled:opacity-50 active:translate-x-[1px] active:translate-y-[1px]"
                                >
                                    <Key size={13} />
                                    <span>{apiKeyLoading ? "REGENERATING..." : "REGENERATE KEY"}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsRevokeModalOpen(true)}
                                    disabled={apiKeyLoading}
                                    className="px-4 py-2 bg-[#1E2227] hover:bg-[#FF3333] hover:text-white text-[#FF6666] border-2 border-black rounded-none font-mono text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-[2px_2px_0px_0px_#000000] cursor-pointer transition-all disabled:opacity-50 active:translate-x-[1px] active:translate-y-[1px]"
                                >
                                    <Trash2 size={13} />
                                    <span>REVOKE KEY</span>
                                </button>
                            </div>

                            {/* Agent Integration Quick Reference */}
                            <div className="p-4 bg-[#0B0E14] border-2 border-black rounded-none shadow-[3px_3px_0px_0px_#000000] font-mono text-[11px] space-y-2.5">
                                <div className="flex items-center gap-2 text-white font-bold uppercase tracking-wider pb-2 border-b border-neutral-800">
                                    <Terminal size={14} className="text-[#FFE600]" />
                                    <span>// AGENT INTEGRATION GUIDE</span>
                                </div>
                                <p className="text-neutral-400">
                                    Include the header <code className="text-[#FFE600] bg-black px-1.5 py-0.5 border border-neutral-700">X-Project-Key: {apiKey.slice(0, 12)}...</code> on requests:
                                </p>
                                <div className="space-y-1.5 text-neutral-300">
                                    <div><span className="text-[#00FF66] font-bold">GET</span> <code className="text-white">/api/agent/tasks/[Title](#ID)</code> <span className="text-neutral-500">// Fetch task by pasted markdown link or ID</span></div>
                                    <div><span className="text-[#FFE600] font-bold">POST</span> <code className="text-white">/api/agent/tasks/[Title](#ID)/complete</code> <span className="text-neutral-500">// Automatically move task to COMPLETED</span></div>
                                    <div><span className="text-[#00FF66] font-bold">GET</span> <code className="text-white">/api/agent/summary</code> <span className="text-neutral-500">// Fetch live project markdown & metrics</span></div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="p-5 bg-[#121417] border-2 border-dashed border-neutral-700 rounded-none flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div>
                                <div className="text-white font-bold text-[13px] uppercase font-mono tracking-wider">
                                    No API Key Generated
                                </div>
                                <div className="text-neutral-400 font-mono text-[11px] mt-1">
                                    Create a secure token to enable IDE AI assistants and background agents to manage project tasks.
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleGenerateApiKey}
                                disabled={apiKeyLoading}
                                className="px-5 py-2.5 bg-[#FFE600] text-black border-2 border-black rounded-none font-mono text-[11px] font-black uppercase tracking-wider flex items-center gap-2 shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] cursor-pointer transition-all disabled:opacity-50 active:translate-x-[1px] active:translate-y-[1px] shrink-0"
                            >
                                <Key size={14} />
                                <span>{apiKeyLoading ? "GENERATING..." : "GENERATE API KEY"}</span>
                            </button>
                        </div>
                    )}
                </div>
            </SurfaceCard>

            {/* Member Management */}
            <SurfaceCard title="Project Members" subtitle={`${members.length} members in project`} icon={Users} rightElement={null}>

                <div className="space-y-6">
                    {/* Existing Members Search Filter */}
                    <div>
                        <div className="relative mb-3">
                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                <Search size={13} className="text-neutral-500" />
                            </div>
                            <input
                                type="text"
                                placeholder="FILTER CURRENT MEMBERS..."
                                value={memberFilter}
                                onChange={(e) => setMemberFilter(e.target.value)}
                                className="w-full bg-[#0B0E14] border-2 border-black rounded-none pl-8 pr-3 py-2 text-[12px] font-mono text-white placeholder:text-neutral-600 focus:border-[#FFE600] focus:outline-none shadow-[2px_2px_0px_0px_#000000]"
                            />
                        </div>

                        <div className="space-y-2.5 max-h-[300px] overflow-y-auto no-scrollbar">
                            {members
                                .filter(m =>
                                    (m.display_name || '').toLowerCase().includes(memberFilter.toLowerCase()) ||
                                    (m.gh_username || '').toLowerCase().includes(memberFilter.toLowerCase()) ||
                                    (m.role || '').toLowerCase().includes(memberFilter.toLowerCase())
                                )
                                .map(m => (
                                    <div key={m.id} className="flex items-center justify-between p-3 rounded-none border-2 border-black bg-[#121417] shadow-[2px_2px_0px_0px_#000000]">
                                        <div>
                                            <div className="text-[13px] font-bold text-white uppercase tracking-wider">{m.display_name || m.gh_username || `User #${m.user_id}`}</div>
                                            <div className="text-[11px] text-[#FFE600] font-bold mt-0.5 uppercase">// {m.role}</div>
                                        </div>
                                    </div>
                                ))}
                            {members.length > 0 && members.filter(m => (m.display_name || '').toLowerCase().includes(memberFilter.toLowerCase()) || (m.gh_username || '').toLowerCase().includes(memberFilter.toLowerCase()) || (m.role || '').toLowerCase().includes(memberFilter.toLowerCase())).length === 0 && (
                                <div className="text-center py-4 text-neutral-500 text-[11px] uppercase">
                                    // NO MEMBERS MATCH FILTER
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-4 border-t-2 border-neutral-800">
                        <h4 className="text-[13px] font-black uppercase tracking-wider text-white mb-4">// ADD NEW MEMBER</h4>

                        {!selectedUser ? (
                            <div className="space-y-2 relative">
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                        <Search size={14} className="text-neutral-400" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="SEARCH USERNAME (LOCAL OR GITHUB)..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full bg-[#0B0E14] border-2 border-black rounded-none pl-9 pr-4 py-2.5 text-[13px] font-mono text-white placeholder:text-neutral-600 focus:border-[#FFE600] focus:outline-none shadow-[2px_2px_0px_0px_#000000]"
                                    />
                                    {isSearching && (
                                        <div className="absolute inset-y-0 right-3 flex items-center">
                                            <div className="w-4 h-4 rounded-none border-2 border-black border-t-[#FFE600] animate-spin"></div>
                                        </div>
                                    )}
                                </div>

                                {searchQuery.length >= 2 && searchResults.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-[#121417] border-2 border-black rounded-none overflow-hidden z-10 shadow-[4px_4px_0px_0px_#000000] max-h-60 overflow-y-auto">
                                        {searchResults.map(u => (
                                            <button
                                                key={u.id || u.gh_username}
                                                onClick={() => setSelectedUser(u)}
                                                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#FFE600] hover:text-black transition-colors text-left font-mono text-[12px] font-bold uppercase text-white cursor-pointer border-b border-neutral-800 last:border-0"
                                            >
                                                <span>{u.gh_username}</span>
                                                {u.display_name && (
                                                    <span className="text-[10px] text-neutral-400 opacity-80 normal-case">{u.display_name}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-[#121417] border-2 border-black rounded-none p-3 text-[12px] font-mono text-neutral-400 text-center z-10 shadow-[4px_4px_0px_0px_#000000]">
                                        NO USERS MATCHING QUERY
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-[#121417] border-2 border-black rounded-none p-4 space-y-4 shadow-[3px_3px_0px_0px_#000000]">
                                <div className="flex items-center justify-between">
                                    <span className="text-[13px] font-bold text-white uppercase">// TARGET: {selectedUser.gh_username}</span>
                                    <button onClick={() => setSelectedUser(null)} className="text-neutral-400 hover:text-white transition-colors cursor-pointer">
                                        <X size={16} strokeWidth={3} />
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold uppercase text-neutral-400 mb-1.5">// ASSIGN ROLE</label>
                                    <select
                                        value={selectedRole}
                                        onChange={(e) => setSelectedRole(e.target.value)}
                                        className="w-full bg-[#0B0E14] border-2 border-black rounded-none px-3 py-2 text-[13px] font-mono text-white focus:border-[#FFE600] focus:outline-none shadow-[2px_2px_0px_0px_#000000]"
                                    >
                                        <option value="" disabled>SELECT A ROLE...</option>
                                        {DEFAULT_ROLES.map(r => (
                                            <option key={r} value={r}>{r}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex justify-end pt-2">
                                    <button
                                        onClick={handleAddMember}
                                        disabled={!selectedRole}
                                        className="flex items-center gap-2 px-5 py-2 bg-[#FFE600] text-black border-2 border-black rounded-none text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] disabled:opacity-50 transition-all cursor-pointer"
                                    >
                                        <Plus size={14} strokeWidth={3} /> Add to Project
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </SurfaceCard>

            {/* GitHub-style Danger Zone */}
            <div className="border-2 border-[#EF4444] bg-[#121417] rounded-none p-6 shadow-[4px_4px_0px_0px_#EF4444]">
                <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-[#EF4444] text-white border-2 border-black rounded-none shadow-[2px_2px_0px_0px_#000000]">
                        <AlertTriangle size={18} strokeWidth={2.5} />
                    </div>
                    <div>
                        <h3 className="text-white font-mono font-black text-[15px] uppercase tracking-wider">
                            // DANGER ZONE
                        </h3>
                        <p className="text-neutral-400 font-mono text-[11px] uppercase tracking-wider">
                            IRREVERSIBLE ACTIONS
                        </p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t-2 border-neutral-800">
                    <div>
                        <h4 className="text-white text-[13px] font-bold uppercase tracking-wider">Delete this project</h4>
                        <p className="text-neutral-400 text-[11px] max-w-xl mt-1 leading-relaxed">
                            Once you delete a project, there is no going back. All tasks, buckets, meetings, and data associated with this project will be permanently erased.
                        </p>
                    </div>
                    <button
                        onClick={() => setIsDeleteModalOpen(true)}
                        className="px-5 py-2.5 bg-[#EF4444] hover:bg-[#DC2626] text-white border-2 border-black rounded-none text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer whitespace-nowrap self-start sm:self-center"
                    >
                        Delete Project
                    </button>
                </div>
            </div>

            {/* Repository Picker Modal */}
            {isRepoPicker && (
                <RepositoryPickerModal
                    projectId={projectId}
                    currentRepoUrls={repoUrls}
                    onClose={() => setIsRepoPicker(false)}
                    onReposUpdated={handleReposUpdated}
                />
            )}

            {/* Remove Custom AI Key Confirmation Modal */}
            {isRemoveProjectAiKeyModalOpen && (
                <ConfirmModal
                    title="REMOVE PROJECT AI KEY?"
                    message="Are you sure you want to remove this custom Gemini API key? The project will revert to using the user or system default AI key for code reviews and meeting summaries."
                    confirmLabel="YES, REMOVE KEY"
                    cancelLabel="CANCEL"
                    variant="danger"
                    onConfirm={handleRemoveCustomAiKey}
                    onCancel={() => setIsRemoveProjectAiKeyModalOpen(false)}
                />
            )}

            {/* Revoke API Key Confirmation Modal */}
            {isRevokeModalOpen && (
                <ConfirmModal
                    title="REVOKE PROJECT API KEY?"
                    message="Are you sure you want to revoke this API key? External code agents or scripts using this key will immediately lose access to this project."
                    confirmLabel="YES, REVOKE KEY"
                    cancelLabel="CANCEL"
                    variant="danger"
                    onConfirm={handleRevokeApiKey}
                    onCancel={() => setIsRevokeModalOpen(false)}
                />
            )}

            {/* Delete Project Confirmation Modal */}
            {isDeleteModalOpen && (
                <ConfirmModal
                    title={`DELETE ${project?.name || 'PROJECT'}?`}
                    message="Are you sure you want to delete this project? All associated tasks, buckets, and configurations will be permanently removed. This action cannot be undone."
                    confirmLabel="YES, DELETE PROJECT"
                    cancelLabel="CANCEL"
                    variant="danger"
                    onConfirm={handleDeleteProject}
                    onCancel={() => setIsDeleteModalOpen(false)}
                />
            )}
        </div>
    );
};
