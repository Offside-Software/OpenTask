import React, { useState, useEffect } from 'react';
import { SurfaceCard } from '../../design-system/SurfaceCard';
import { Settings, Users, Plus, Search, Save, X, AlertTriangle } from 'lucide-react';
import { projectService } from '../../services/projectService';
import { projectMemberService } from '../../services/projectMemberService';
import { userService } from '../../services/userService';
import { searchGithubUsers } from '../../services/githubServices';
import { useToast } from '../../design-system/Toast';
import { ConfirmModal } from '../modals/ConfirmModal';
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

    // Project Edit State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    // Add Member State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<{ id?: number | string; gh_username: string; display_name?: string }[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedUser, setSelectedUser] = useState<{ id?: number | string; gh_username: string } | null>(null);
    const [selectedRole, setSelectedRole] = useState('');

    const loadData = async () => {
        setLoading(true);
        try {
            const [p, m] = await Promise.all([
                projectService.getProjectById(projectId),
                projectMemberService.getMembers(projectId),
            ]);
            setProject(p);
            setName(p.name || '');
            setDescription(p.description || '');
            setMembers(m);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
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
        return <div className="text-slate-500 py-10 text-center">Loading settings...</div>;
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
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#FFE600] text-black border-2 border-black rounded-none text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] transition-all cursor-pointer"
                    >
                        <Save size={14} strokeWidth={2.5} /> Save Changes
                    </button>
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
