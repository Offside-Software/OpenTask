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
  const displayName = user ? getDisplayName(user) : 'Operator';

  const totalRepos = projects.reduce((acc, p) => acc + (p.gh_repo_url?.length || 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200 max-w-[1600px] mx-auto w-full select-none">
      {/* Header */}
      <div className="flex justify-between items-end flex-wrap gap-5 border-b border-border pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 mb-1.5 px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded-md text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span>DevOps Command Center</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            Hello {displayName}!
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            System status operational • Workload ready
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="md"
            onClick={() => navigate('/notifications')}
            className="flex items-center gap-2"
          >
            <Bell size={14} /> Alerts
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => navigate('/workspaces')}
            className="flex items-center gap-2"
          >
            <Plus size={14} /> New Project
          </Button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-card text-card-foreground border border-border rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground font-medium mb-1">Workspaces</div>
            <div className="text-2xl font-bold text-foreground">{projects.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Active managed projects</div>
          </div>
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
            <Briefcase size={20} />
          </div>
        </div>

        <div className="bg-card text-card-foreground border border-border rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground font-medium mb-1">Linked Repositories</div>
            <div className="text-2xl font-bold text-foreground">{totalRepos}</div>
            <div className="text-xs text-muted-foreground mt-0.5">GitHub repositories attached</div>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <GitBranch size={20} />
          </div>
        </div>

        <div className="bg-card text-card-foreground border border-border rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground font-medium mb-1">AI Agent Pipeline</div>
            <div className="text-2xl font-bold text-primary">Ready</div>
            <div className="text-xs text-muted-foreground mt-0.5">Automated code reviews enabled</div>
          </div>
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
            <Bot size={20} />
          </div>
        </div>
      </div>

      {/* Active Projects Hub */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary border border-primary/20">
              <FolderGit2 size={16} />
            </div>
            <h2 className="text-foreground text-sm font-semibold">
              Active Workspaces
            </h2>
          </div>
          <button
            onClick={() => navigate('/workspaces')}
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>View all ({projects.length})</span>
            <ArrowRight size={13} />
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            Loading workspaces...
          </div>
        ) : projects.length === 0 ? (
          <SurfaceCard title="No workspaces configured" subtitle="Create a project to initialize task pipelines" icon={Briefcase} rightElement={null}>
            <div className="py-8 text-center space-y-4">
              <p className="text-muted-foreground text-xs max-w-md mx-auto">
                No active projects found. Create a new project workspace to start organizing tasks, tracking progress, and enabling AI code reviews.
              </p>
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/workspaces')}
                className="inline-flex items-center gap-2"
              >
                <Plus size={14} /> Initialize First Project
              </Button>
            </div>
          </SurfaceCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.slice(0, 6).map((project) => (
              <ProjectCard
                key={String(project.id)}
                title={project.name || 'Untitled Project'}
                desc={project.description || 'No description provided.'}
                onClick={() => navigate(`/projects/${project.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* AI Agent Quick Integration Banner */}
      <SurfaceCard
        title="AI Agent Command Center"
        subtitle="Autonomous code agents & IDE assistant integration"
        icon={Bot}
        rightElement={
          <span className="text-[10px] font-semibold uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-md">
            Online
          </span>
        }
      >
        <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
          <p>
            OpenTask provides programmatic endpoints for AI coding assistants (Cursor, Claude Code, Antigravity, Aider). External agents can read project boards, fetch task requirements, and transition task statuses using project API keys.
          </p>
          <div className="p-3 bg-muted/40 border border-border rounded-lg flex items-center justify-between gap-4 flex-wrap">
            <span className="text-foreground text-xs font-medium">
              Navigate to any Project &gt; Settings &gt; AI Agent Access to generate an authentication token.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/workspaces')}
              className="shrink-0"
            >
              Open Workspaces
            </Button>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
};
