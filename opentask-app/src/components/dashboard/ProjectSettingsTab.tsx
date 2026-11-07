import React, { useState, useEffect } from 'react';
import { SurfaceCard } from '../../design-system/SurfaceCard';
import { Badge } from '../../design-system/Badge';
import { Button } from '../../design-system/Button';
import { Settings, Users, Plus, Search, Save, X, AlertTriangle, Github, GitBranch, Trash2, ExternalLink, Bot, Key, Copy, Check, Eye, EyeOff, Sparkles, CheckCircle2, RefreshCw, Cpu } from 'lucide-react';
import { projectService } from '../../services/projectService';
import { projectMemberService } from '../../services/projectMemberService';
import { userService } from '../../services/userService';
import { searchGithubUsers } from '../../services/githubServices';
import { aiKeyService, type ProjectAiKeyResponse } from '../../services/aiKeyService';
import { useToast } from '../../design-system/Toast';
import { ConfirmModal } from '../modals/ConfirmModal';
import { LoadingScreen } from '../ui/LoadingScreen';
import { RepositoryPickerModal } from '../modals/RepositoryPickerModal';
import { McpConfigModal } from '../modals/McpConfigModal';
import { GroqKeyCard } from '../meetings/GroqKeyCard';
import { useNavigate } from 'react-router-dom';
import { getCached, setCached } from '../../utils/cache';
import type { Project, ProjectMember } from '../../models';
import { useCurrentUserRole } from '../../controllers/useCurrentUserRole';
import { useAuth } from '../../auth/useAuth';

interface ProjectSettingsTabProps {
    projectId: string | number;
    onProjectUpdated?: (project: Project) => void;
    onMembersChanged?: () => Promise<unknown>;
    onMemberRemoved?: (userId: string | number) => void;
}

// Hard-coded list of roles (no longer stored in the DB projects table).
const DEFAULT_ROLES = ['Owner', 'Manager', 'Programmer', 'Designer', 'QA'];

export const ProjectSettingsTab: React.FC<ProjectSettingsTabProps> = ({
    projectId,
    onProjectUpdated,
    onMembersChanged,
    onMemberRemoved,
}) => {
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
    const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);

    // Custom Integrated AI (Gemini Key) State
    const [customAiKeyInfo, setCustomAiKeyInfo] = useState<ProjectAiKeyResponse | null>(null);
    const [customAiInput, setCustomAiInput] = useState('');
    const [isReplacingKey, setIsReplacingKey] = useState(false);
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
    const [editingMemberId, setEditingMemberId] = useState<string | number | null>(null);
    const [editingRole, setEditingRole] = useState('');

    const { user } = useAuth();
    const dbUserId = user?.db_user?.id;
    const { role } = useCurrentUserRole(projectId, dbUserId);
    const isManager = role?.toUpperCase() === 'MANAGER' || role?.toUpperCase() === 'OWNER';

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
            const hasCustom = Boolean(
                customKeyData?.has_custom_key ||
                customKeyData?.has_key ||
                customKeyData?.masked_key ||
                p?.custom_ai_api_key
            );
            setCustomAiKeyInfo(
                customKeyData
                    ? {
                        ...customKeyData,
                        has_custom_key: hasCustom,
                        has_key: hasCustom,
                        masked_key: customKeyData.masked_key || (p?.custom_ai_api_key ? 'AIzaSy••••••••••••' : null),
                    }
                    : hasCustom
                        ? {
                            project_id: String(projectId),
                            has_custom_key: true,
                            has_key: true,
                            masked_key: 'AIzaSy••••••••••••',
                        }
                        : null
            );
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
            if (project) {
                setProject({ ...project, custom_ai_api_key: keyToSave });
            }
            setCustomAiInput('');
            setAiKeyTestResult(null);
            setShowCustomAiKey(false);
            setIsReplacingKey(false);
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
            setCustomAiKeyInfo({ project_id: String(projectId), has_custom_key: false, has_key: false, masked_key: null });
            if (project) {
                setProject({ ...project, custom_ai_api_key: undefined });
            }
            setCustomAiInput('');
            setAiKeyTestResult(null);
            setIsReplacingKey(false);
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
            showToast("Project API key generated and stored to database", "success");
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

    const handleAddMember = async () => {
        if (!selectedUser || !selectedRole)
            return;

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
            await onMembersChanged?.();
            setSelectedUser(null);
            setSearchQuery('');
            setSelectedRole('');
            showToast('Member added successfully', 'success');
        } catch (e) {
            console.error(e);
            showToast('Failed to add member', 'error');
        }
    };

    const handleRemoveMember = async (member_id: string | number) => {
        if (member_id === null || member_id === undefined)
            return;

        try {
            const removedMember = members.find(member => String(member.id) === String(member_id));
            await projectMemberService.removeMember(projectId, member_id);
            setMembers(current => current.filter(member => String(member.id) !== String(member_id)));
            if (removedMember?.user_id !== undefined) {
                onMemberRemoved?.(removedMember.user_id);
            }
            await onMembersChanged?.();
            showToast('Member removed successfully', 'success');
        } catch (e) {
            console.error(e);
            showToast('Failed to remove member', 'error');
        }
    };

    const handleEditMember = (member: ProjectMember) => {
        if (member.id === undefined) return;
        setEditingMemberId(member.id);
        setEditingRole(member.role);
    };

    const handleSaveMember = async (member: ProjectMember) => {
        if (member.id === undefined || !editingRole) return;

        try {
            const updated = await projectMemberService.updateMember(projectId, member.id, {
                role: editingRole,
            });
            setMembers(current => current.map(item => (
                String(item.id) === String(updated.id) ? updated : item
            )));
            await onMembersChanged?.();
            setEditingMemberId(null);
            setEditingRole('');
            showToast('Member updated successfully', 'success');
        } catch (e) {
            console.error(e);
            showToast('Failed to update member', 'error');
        }
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

    const hasCustomAiKey = Boolean(
        customAiKeyInfo?.has_custom_key ||
        customAiKeyInfo?.has_key ||
        customAiKeyInfo?.masked_key ||
        project?.custom_ai_api_key
    );
    const displayMaskedAiKey = customAiKeyInfo?.masked_key || 'AIzaSy••••••••••••••••••••';

    const isProjectDirty = project ? (
        name.trim() !== (project.name || '').trim() ||
        description.trim() !== (project.description || '').trim()
    ) : false;

    return (
        <div className="space-y-6 select-none">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* General Settings */}
                <SurfaceCard className="lg:col-span-2" title="Project Details" subtitle="Update basic project information" icon={Settings} rightElement={null}>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-foreground mb-1.5">Project Title</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="w-full bg-background border border-input rounded-md px-3 py-2 text-xs text-foreground focus:ring-1 focus:ring-ring focus:outline-none transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-foreground mb-1.5">Description</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="w-full bg-background border border-input rounded-md px-3 py-2 text-xs text-foreground focus:ring-1 focus:ring-ring focus:outline-none min-h-[100px] transition-colors resize-y"
                            />
                        </div>

                        <Button
                            variant="primary"
                            onClick={handleUpdateProject}
                            disabled={!isProjectDirty || !name.trim()}
                            className="flex items-center gap-2"
                        >
                            <Save size={14} /> <span>Save Changes</span>
                        </Button>
                    </div>
                </SurfaceCard>

                {/* Member Management */}
                <SurfaceCard className="lg:col-span-2" title="Project Members" subtitle={`${members.length} members in project`} icon={Users} rightElement={null}>
                    <div className="space-y-5">
                        {/* Existing Members Search Filter */}
                        <div>
                            <div className="relative mb-3">
                                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                    <Search size={13} className="text-muted-foreground" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Filter current members..."
                                    value={memberFilter}
                                    onChange={(e) => setMemberFilter(e.target.value)}
                                    className="w-full bg-background border border-input rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-none transition-colors"
                                />
                            </div>

                            <div className="space-y-2 max-h-[220px] overflow-y-auto">
                                {members
                                    .filter(m =>
                                        (m.display_name || '').toLowerCase().includes(memberFilter.toLowerCase()) ||
                                        (m.gh_username || '').toLowerCase().includes(memberFilter.toLowerCase()) ||
                                        (m.role || '').toLowerCase().includes(memberFilter.toLowerCase())
                                    )
                                    .map(m => (
                                        <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card shadow-xs">
                                            <div>
                                                <div className="text-xs font-semibold text-foreground">{m.display_name || m.gh_username || `User #${m.user_id}`}</div>
                                                {editingMemberId === m.id ? (
                                                    <select
                                                        value={editingRole}
                                                        onChange={(e) => setEditingRole(e.target.value)}
                                                        className="mt-1 bg-background border border-input rounded-md px-2 py-1 text-xs text-foreground focus:ring-1 focus:ring-ring focus:outline-none"
                                                    >
                                                        {DEFAULT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                                    </select>
                                                ) : (
                                                    <div className="text-[11px] text-primary font-medium mt-0.5">{m.role}</div>
                                                )}
                                            </div>

                                            {isManager && (
                                                <div className="flex items-center gap-2">
                                                    {editingMemberId === m.id ? (
                                                        <Button
                                                            variant="success"
                                                            size="sm"
                                                            type="button"
                                                            onClick={() => handleSaveMember(m)}
                                                        >
                                                            Save
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            type="button"
                                                            onClick={() => handleEditMember(m)}
                                                        >
                                                            Edit
                                                        </Button>
                                                    )}

                                                    {(m.role.toUpperCase() !== "MANAGER" && m.role.toUpperCase() !== "OWNER" &&
                                                        <button
                                                            onClick={() => m.id !== undefined && handleRemoveMember(m.id)}
                                                            className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                                                            title="Remove member"
                                                        >
                                                            <X size={15} />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                {members.length > 0 && members.filter(m => (m.display_name || '').toLowerCase().includes(memberFilter.toLowerCase()) || (m.gh_username || '').toLowerCase().includes(memberFilter.toLowerCase()) || (m.role || '').toLowerCase().includes(memberFilter.toLowerCase())).length === 0 && (
                                    <div className="text-center py-4 text-neutral-500 text-[11px] uppercase">
                                        // NO MEMBERS MATCH FILTER
                                    </div>
                                )}
                            </div>
                        </div>

                        {isManager && (
                            <div className="pt-4 border-t border-border">
                                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground mb-3">Add New Member</h4>
                                {!selectedUser ? (
                                    <div className="space-y-2 relative">
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                                <Search size={14} className="text-muted-foreground" />
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Search username (local or GitHub)..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full bg-background border border-input rounded-md pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-none transition-colors"
                                            />
                                            {isSearching && (
                                                <div className="absolute inset-y-0 right-3 flex items-center">
                                                    <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                                                </div>
                                            )}
                                        </div>

                                        {searchQuery.length >= 2 && searchResults.length > 0 && (
                                            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg overflow-hidden z-10 shadow-lg max-h-60 overflow-y-auto divide-y divide-border">
                                                {searchResults.map(u => (
                                                    <button
                                                        key={u.id || u.gh_username}
                                                        onClick={() => setSelectedUser(u)}
                                                        className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-muted/50 transition-colors text-left text-xs font-medium text-foreground cursor-pointer"
                                                    >
                                                        <span>{u.gh_username}</span>
                                                        {u.display_name && (
                                                            <span className="text-[11px] text-muted-foreground">{u.display_name}</span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                                            <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg p-3 text-xs text-muted-foreground text-center z-10 shadow-lg">
                                                No users matching query
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-muted/30 border border-border rounded-lg p-3.5 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-semibold text-foreground">Target: {selectedUser.gh_username}</span>
                                            <button onClick={() => setSelectedUser(null)} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                                                <X size={15} />
                                            </button>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Assign Role</label>
                                            <select
                                                value={selectedRole}
                                                onChange={(e) => setSelectedRole(e.target.value)}
                                                className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-ring focus:outline-none"
                                            >
                                                <option value="" disabled>Select a role...</option>
                                                {DEFAULT_ROLES.map(r => (
                                                    <option key={r} value={r}>{r}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex justify-end pt-1">
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={handleAddMember}
                                                disabled={!selectedRole}
                                                className="flex items-center gap-1.5"
                                            >
                                                <Plus size={14} /> <span>Add to Project</span>
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </SurfaceCard>

                {/* Connected Repositories */}
                <SurfaceCard title="Connected Repositories" subtitle={`${repoUrls.length} repo${repoUrls.length !== 1 ? 's' : ''} linked`} icon={GitBranch} rightElement={null}>
                    <div className="space-y-4">
                        {repoUrls.length === 0 ? (
                            <div className="py-6 text-center border border-dashed border-border rounded-lg bg-card/50">
                                <Github size={22} className="text-muted-foreground mx-auto mb-2" />
                                <p className="text-muted-foreground text-xs font-medium">No repositories connected</p>
                                <p className="text-muted-foreground text-[11px] mt-0.5">Connect repos to enable AI code review</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {repoUrls.map((url) => {
                                    const repoName = url.replace('https://github.com/', '');
                                    const [orgName, repoShortName] = repoName.split('/');
                                    return (
                                        <div key={url} className="flex items-center justify-between p-3 bg-card border border-border rounded-lg shadow-xs">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="p-1.5 bg-primary/10 text-primary border border-primary/20 rounded-md">
                                                    <Github size={13} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-xs font-semibold text-foreground truncate">{repoShortName || repoName}</div>
                                                    <div className="text-[11px] text-muted-foreground">{orgName}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors p-1">
                                                    <ExternalLink size={13} />
                                                </a>
                                                <button
                                                    onClick={() => handleRemoveRepo(url)}
                                                    className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer p-1"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <Button
                            variant="primary"
                            onClick={() => setIsRepoPicker(true)}
                            className="w-full flex items-center justify-center gap-2"
                        >
                            <Github size={14} /> <span>Connect Repository</span>
                        </Button>
                    </div>
                </SurfaceCard>
            </div>

            <div className="grid grid-cols-3 gap-6">
                {/* Custom Integrated AI (BYOT Gemini Key) */}
                <SurfaceCard
                    title="Custom Integrated AI"
                    subtitle="BRING YOUR OWN GEMINI KEY FOR PR REVIEWS, MEETINGS & TASK EVALUATIONS"
                    icon={Sparkles}
                    rightElement={
                        hasCustomAiKey ? (
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

                        {hasCustomAiKey && !isReplacingKey ? (
                            <div className="p-4 bg-muted/30 border border-border rounded-lg flex items-center justify-between gap-4 shadow-xs flex-wrap">
                                <div className="flex items-center gap-3.5 min-w-0">
                                    <div className="p-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg shrink-0">
                                        <CheckCircle2 size={16} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                                Active Project Key
                                            </span>
                                        </div>
                                        <div className="text-sm font-semibold text-foreground tracking-widest mt-1 truncate">
                                            {displayMaskedAiKey}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                            Dedicated quotas active for PR reviews, MoM parser, and task automation.
                                        </p>
                                    </div>
                                </div>
                                {isManager && (
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            type="button"
                                            onClick={() => {
                                                setIsReplacingKey(true);
                                                setCustomAiInput('');
                                                setAiKeyTestResult(null);
                                            }}
                                            className="flex items-center gap-1.5"
                                        >
                                            <RefreshCw size={12} />
                                            <span>Replace Key</span>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            type="button"
                                            onClick={() => setIsRemoveProjectAiKeyModalOpen(true)}
                                            className="flex items-center gap-1.5 hover:text-destructive hover:bg-destructive/10"
                                        >
                                            <Trash2 size={12} />
                                            <span>Remove</span>
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="block text-xs font-medium text-foreground">
                                            {isReplacingKey ? "Enter replacement Gemini API key" : "Enter Google Gemini API key"}
                                        </label>
                                        <a
                                            href="https://aistudio.google.com/app/apikey"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                        >
                                            <span>Get free key (AI Studio)</span>
                                            <ExternalLink size={11} />
                                        </a>
                                    </div>

                                    <div className="flex items-center gap-2.5 flex-wrap">
                                        <div className="relative flex-1 min-w-[280px]">
                                            <input
                                                type={showCustomAiKey ? "text" : "password"}
                                                value={customAiInput}
                                                onChange={(e) => {
                                                    setCustomAiInput(e.target.value);
                                                    setAiKeyTestResult(null);
                                                }}
                                                placeholder={isReplacingKey ? "Enter new API key (AIzaSy...)" : "AIzaSy..."}
                                                className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs text-foreground tracking-wider focus:ring-1 focus:ring-ring focus:outline-none"
                                            />
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            type="button"
                                            onClick={() => setShowCustomAiKey(!showCustomAiKey)}
                                            title={showCustomAiKey ? "Hide Key" : "Reveal Key"}
                                        >
                                            {showCustomAiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                                            <span>{showCustomAiKey ? "Hide" : "Reveal"}</span>
                                        </Button>
                                        {isReplacingKey && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                type="button"
                                                onClick={() => {
                                                    setIsReplacingKey(false);
                                                    setCustomAiInput('');
                                                    setAiKeyTestResult(null);
                                                }}
                                            >
                                                <X size={13} />
                                                <span>Cancel</span>
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            type="button"
                                            onClick={handleTestCustomAiKey}
                                            disabled={aiKeyTesting || !customAiInput.trim()}
                                        >
                                            <Bot size={13} />
                                            <span>{aiKeyTesting ? "Testing..." : "Test Key"}</span>
                                        </Button>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            type="button"
                                            onClick={handleSaveCustomAiKey}
                                            disabled={aiKeySaving || !customAiInput.trim()}
                                        >
                                            <Save size={13} />
                                            <span>{aiKeySaving ? "Saving..." : "Save Key"}</span>
                                        </Button>
                                    </div>
                                </div>

                                {/* Test Feedback banner */}
                                {aiKeyTestResult && (
                                    <div
                                        className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${aiKeyTestResult.valid
                                                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-medium"
                                                : "bg-destructive/10 text-destructive border-destructive/20 font-medium"
                                            }`}
                                    >
                                        {aiKeyTestResult.valid ? (
                                            <>
                                                <CheckCircle2 size={15} />
                                                <span>Key valid & ready! Verified with model: {aiKeyTestResult.model}</span>
                                            </>
                                        ) : (
                                            <>
                                                <AlertTriangle size={15} />
                                                <span>Validation error: {aiKeyTestResult.error || "Invalid key"}</span>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </SurfaceCard>

                {/* Meeting pipeline: the project's own Groq key */}
                <GroqKeyCard className="col-span-1" projectId={projectId} />

                {/* AI Native Agent Access Card */}
                <SurfaceCard
                    title="AI Agent Access"
                    subtitle="Programmatic API for code agents (Cursor, Antigravity, Claude, Aider)"
                    icon={Bot}
                    rightElement={
                        apiKey && (
                            <Badge variant="success">
                                Active
                            </Badge>
                        )
                    }
                >
                    <div className="space-y-4">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Authorize external AI coding agents to interact directly with this project. Agents can look up tasks using copied IDs, mark tasks complete, move tasks between pipeline stages, and fetch project status summaries.
                        </p>

                        {apiKey ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                        Project API Key (Secret)
                                    </label>
                                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                        <div className="relative flex-1 min-w-[280px]">
                                            <input
                                                type={showApiKey ? "text" : "password"}
                                                readOnly
                                                value={apiKey}
                                                className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs text-primary font-mono tracking-wider focus:outline-none select-all"
                                            />
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            type="button"
                                            onClick={() => setShowApiKey(!showApiKey)}
                                            title={showApiKey ? "Hide Key" : "Reveal Key"}
                                        >
                                            {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                                            <span>{showApiKey ? "Hide" : "Reveal"}</span>
                                        </Button>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            type="button"
                                            onClick={handleCopyApiKey}
                                        >
                                            {copiedKey ? <Check size={13} /> : <Copy size={13} />}
                                            <span>{copiedKey ? "Copied!" : "Copy"}</span>
                                        </Button>
                                    </div>
                                </div>
                                {isManager && (
                                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            type="button"
                                            onClick={handleGenerateApiKey}
                                            disabled={apiKeyLoading}
                                        >
                                            <Key size={13} />
                                            <span>{apiKeyLoading ? "Regenerating..." : "Regenerate Key"}</span>
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            type="button"
                                            onClick={() => setIsRevokeModalOpen(true)}
                                            disabled={apiKeyLoading}
                                            className="hover:text-destructive hover:bg-destructive/10"
                                        >
                                            <Trash2 size={13} />
                                            <span>Revoke Key</span>
                                        </Button>
                                    </div>
                                )}

                                {/* MCP IDE Integration Box */}
                                <div className="p-3.5 bg-muted/30 border border-border rounded-lg shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2 text-foreground text-xs font-semibold">
                                            <Cpu size={14} className="text-primary" />
                                            <span>Model Context Protocol (MCP) Integration</span>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                            Expose project tasks directly to Antigravity, Cursor, VS Code (Cline/Copilot), Zed, and Claude Desktop.
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        type="button"
                                        onClick={() => setIsMcpModalOpen(true)}
                                        className="shrink-0"
                                    >
                                        <Cpu size={13} />
                                        <span>View MCP Configs</span>
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 bg-muted/20 border border-dashed border-border rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div>
                                    <div className="text-foreground font-semibold text-xs">
                                        No API Key Generated
                                    </div>
                                    <div className="text-muted-foreground text-[11px] mt-0.5">
                                        Create a secure token to enable IDE AI assistants and background agents to manage project tasks.
                                    </div>
                                </div>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    type="button"
                                    onClick={handleGenerateApiKey}
                                    disabled={apiKeyLoading}
                                    className="shrink-0"
                                >
                                    <Key size={13} />
                                    <span>{apiKeyLoading ? "Generating..." : "Generate API Key"}</span>
                                </Button>
                            </div>
                        )}
                    </div>
                </SurfaceCard>
            </div>

            {/* GitHub-style Danger Zone */}
            {isManager && (
                <div className="border border-destructive/30 bg-destructive/5 rounded-xl p-6 shadow-xs">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg">
                            <AlertTriangle size={18} />
                        </div>
                        <div>
                            <h3 className="text-destructive font-semibold text-sm">
                                Danger Zone
                            </h3>
                            <p className="text-muted-foreground text-xs">
                                Irreversible project actions
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-destructive/20">
                        <div>
                            <h4 className="text-foreground text-xs font-semibold">Delete this project</h4>
                            <p className="text-muted-foreground text-xs max-w-xl mt-0.5 leading-relaxed">
                                Once you delete a project, there is no going back. All tasks, buckets, meetings, and data associated with this project will be permanently erased.
                            </p>
                        </div>
                        <Button
                            variant="danger"
                            size="md"
                            onClick={() => setIsDeleteModalOpen(true)}
                            className="whitespace-nowrap self-start sm:self-center"
                        >
                            Delete Project
                        </Button>
                    </div>
                </div>
            )}


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

            <McpConfigModal
                isOpen={isMcpModalOpen}
                onClose={() => setIsMcpModalOpen(false)}
                projectId={projectId}
                projectName={project?.name}
                initialApiKey={apiKey}
            />
        </div>
    );
};
