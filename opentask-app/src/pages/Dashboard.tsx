import React from 'react';
import {
  Briefcase,
  GitBranch,
  Bell,
  Bot,
  Plus,
  ArrowRight,
  FolderGit2
} from 'lucide-react';
import { SurfaceCard } from '../design-system/SurfaceCard';
import { Button } from '../design-system/Button';
import { ProjectCard } from '../components/dashboard/ProjectCard';
import { useAuth } from '../auth/useAuth';
import { getDisplayName } from '../auth/displayName';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '../controllers/useProjects';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { projects, loading } = useProjects();
  const displayName = user ? getDisplayName(user) : 'OPERATOR';

  const totalRepos = projects.reduce((acc, p) => acc + (p.gh_repo_url?.length || 0), 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-200 max-w-[1600px] mx-auto w-full select-none font-mono">
      {/* Header */}
      <div className="flex justify-between items-end flex-wrap gap-4 border-b-2 border-neutral-800 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-2 px-2 py-0.5 bg-[#FFE600] text-black border border-black text-[10px] font-black uppercase tracking-wider shadow-[2px_2px_0px_0px_#000000]">
            <span className="w-2 h-2 bg-black animate-pulse" /> DEV OPS // COMMAND CENTER
          </div>
          <h1 className="text-[28px] sm:text-[34px] font-black text-white uppercase tracking-tight">
            HELLO {displayName}!
          </h1>
          <p className="text-[12px] text-neutral-400 mt-0.5 uppercase tracking-wider">
            [SYSTEM STATUS: OPERATIONAL] • WORKLOAD READY
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="md"
            onClick={() => navigate('/notifications')}
            className="flex items-center gap-2"
          >
            <Bell size={14} /> ALERTS
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => navigate('/workspaces')}
            className="flex items-center gap-2"
          >
            <Plus size={14} strokeWidth={3} /> NEW PROJECT
          </Button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-[#121417] border-2 border-black rounded-none p-5 shadow-[4px_4px_0px_0px_#000000] flex items-center justify-between">
          <div>
            <div className="text-[10px] text-neutral-400 uppercase tracking-wider font-bold mb-1">// WORKSPACES</div>
            <div className="text-[28px] font-black text-white">{projects.length}</div>
            <div className="text-[10px] text-neutral-500 mt-1 uppercase">Active managed projects</div>
          </div>
          <div className="p-3 bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
            <Briefcase size={22} strokeWidth={2.5} />
          </div>
        </div>

        <div className="bg-[#121417] border-2 border-black rounded-none p-5 shadow-[4px_4px_0px_0px_#000000] flex items-center justify-between">
          <div>
            <div className="text-[10px] text-neutral-400 uppercase tracking-wider font-bold mb-1">// LINKED REPOSITORIES</div>
            <div className="text-[28px] font-black text-white">{totalRepos}</div>
            <div className="text-[10px] text-neutral-500 mt-1 uppercase">GitHub repositories attached</div>
          </div>
          <div className="p-3 bg-[#00FF66] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
            <GitBranch size={22} strokeWidth={2.5} />
          </div>
        </div>

        <div className="bg-[#121417] border-2 border-black rounded-none p-5 shadow-[4px_4px_0px_0px_#000000] flex items-center justify-between">
          <div>
            <div className="text-[10px] text-neutral-400 uppercase tracking-wider font-bold mb-1">// AI AGENT PIPELINE</div>
            <div className="text-[28px] font-black text-[#FFE600]">READY</div>
            <div className="text-[10px] text-neutral-500 mt-1 uppercase">Automated code reviews enabled</div>
          </div>
          <div className="p-3 bg-black text-[#FFE600] border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
            <Bot size={22} strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {/* Active Projects Hub */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-black text-[#FFE600] border-2 border-black shadow-[2px_2px_0px_0px_#000000]">
              <FolderGit2 size={16} strokeWidth={2.5} />
            </div>
            <h2 className="text-white text-[15px] font-black uppercase tracking-wider">
              // ACTIVE WORKSPACES
            </h2>
          </div>
          <button
            onClick={() => navigate('/workspaces')}
            className="text-[11px] font-black text-[#FFE600] hover:underline flex items-center gap-1 uppercase tracking-wider cursor-pointer"
          >
            <span>VIEW ALL ({projects.length})</span>
            <ArrowRight size={13} strokeWidth={2.5} />
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-neutral-500 text-[12px] uppercase">
            // LOADING WORKSPACES...
          </div>
        ) : projects.length === 0 ? (
          <SurfaceCard title="NO WORKSPACES CONFIGURED" subtitle="CREATE A PROJECT TO INITIALIZE TASK PIPELINES" icon={Briefcase} rightElement={null}>
            <div className="py-8 text-center space-y-4">
              <p className="text-neutral-400 text-[12px] max-w-md mx-auto">
                No active projects found. Create a new project workspace to start organizing tasks, tracking progress, and enabling AI code reviews.
              </p>
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/workspaces')}
                className="inline-flex items-center gap-2"
              >
                <Plus size={14} strokeWidth={3} /> INITIALIZE FIRST PROJECT
              </Button>
            </div>
          </SurfaceCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.slice(0, 6).map((project) => (
              <ProjectCard
                key={String(project.id)}
                title={project.name || 'UNTITLED PROJECT'}
                desc={project.description || 'No description provided.'}
                onClick={() => navigate(`/projects/${project.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* AI Agent Quick Integration Banner */}
      <SurfaceCard
        title="AI AGENT COMMAND CENTER"
        subtitle="AUTONOMOUS CODE AGENTS & IDE ASSISTANT INTEGRATION"
        icon={Bot}
        rightElement={
          <span className="text-[10px] font-black uppercase bg-[#00FF66] text-black px-2 py-0.5 border border-black shadow-[1px_1px_0px_0px_#000000]">
            ONLINE
          </span>
        }
      >
        <div className="space-y-3 text-[12px] text-neutral-400 leading-relaxed">
          <p>
            OpenTask provides programmatic endpoints for AI coding assistants (Cursor, Claude Code, Antigravity, Aider). External agents can read project boards, fetch task requirements, and transition task statuses using project API keys.
          </p>
          <div className="p-3 bg-[#0B0E14] border-2 border-black rounded-none flex items-center justify-between gap-4 flex-wrap">
            <span className="text-white text-[11px] font-bold">
              Navigate to any Project &gt; Settings &gt; AI Agent Access to generate an authentication token.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/workspaces')}
              className="shrink-0"
            >
              OPEN WORKSPACES
            </Button>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
};
