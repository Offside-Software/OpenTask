import React, { useState } from 'react';
import { Briefcase, Plus } from 'lucide-react';
import { ProjectCard } from '../components/dashboard/ProjectCard';
import { useProjects } from '../controllers/useProjects';
import { ProjectFormModal } from '../components/modals/ProjectFormModal';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { Button } from '../design-system/Button';
import type { Project } from '../models';

import { useNavigate } from 'react-router-dom';

type ModalMode = 'create' | 'edit' | null;

export const WorkspacesPage: React.FC = () => {
  const { projects, loading, createProject } = useProjects();
  const navigate = useNavigate();
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editTarget, setEditTarget] = useState<Partial<Project>>({});

  const handleCreate = async (data: Pick<Project, 'name' | 'gh_repo_url'> & Partial<Project>) => {
    await createProject(data);
  };

  const openCreate = () => {
    setEditTarget({});
    setModalMode('create');
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200 max-w-[1400px] mx-auto w-full select-none">
      {/* Header */}
      <div className="flex justify-between items-end border-b border-border pb-5">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary mb-1 inline-block">
            Workspaces Hub
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight leading-tight">Workspaces</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Managed projects & code review pipelines
          </p>
        </div>
        <Button
          variant="primary"
          onClick={openCreate}
          className="flex items-center gap-2"
        >
          <Plus size={15} /> <span>New Project</span>
        </Button>
      </div>

      {/* Projects */}
      <section>
        <div className="flex items-center gap-2.5 mb-5">
          <div className="p-1.5 rounded-md bg-primary/10 text-primary border border-primary/20">
            <Briefcase size={16} />
          </div>
          <h2 className="text-foreground text-sm font-semibold">
            Active Projects
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-5">
          {loading ? (
            <div className="col-span-3 py-12 flex items-center justify-center">
              <LoadingScreen
                fullscreen={false}
                message="Loading workspaces…"
                subtext="Discovering active pipelines & repositories"
              />
            </div>
          ) : projects.length === 0 ? (
            <div className="col-span-3 text-center py-16 text-muted-foreground text-xs border border-dashed border-border bg-card/50 rounded-xl shadow-xs">
              No projects found.{' '}
              <button onClick={openCreate} className="text-primary hover:underline font-medium ml-1 cursor-pointer">
                Create one now.
              </button>
            </div>
          ) : projects.map(p => (
            <ProjectCard
              key={p.id}
              title={p.name}
              desc={p.issue || "System operating within normal parameters."}
              progress={p.progress}
              onClick={() => navigate(`/projects/${p.id}`)}
            />
          ))}
        </div>
      </section>

      {/* Modal */}
      {modalMode === 'create' && (
        <ProjectFormModal
          title="New Project"
          initial={editTarget}
          onClose={() => setModalMode(null)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
};
