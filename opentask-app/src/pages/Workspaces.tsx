import React, { useState } from 'react';
import { Briefcase, Plus } from 'lucide-react';
import { ProjectCard } from '../components/dashboard/ProjectCard';
import { useProjects } from '../controllers/useProjects';
import { ProjectFormModal } from '../components/modals/ProjectFormModal';
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
    <div className="space-y-10 animate-in fade-in duration-200 max-w-[1400px] mx-auto w-full select-none">

      {/* Header */}
      <div className="flex justify-between items-end border-b-2 border-neutral-800 pb-6">
        <div>
          <span className="text-[#FFE600] bg-black px-1.5 py-0.5 border border-neutral-700 font-mono text-[10px] font-black uppercase tracking-wider mb-2 inline-block">
            // WORKSPACES HUB
          </span>
          <h1 className="text-[32px] font-black text-white font-mono uppercase tracking-tight leading-tight">WORKSPACES</h1>
          <p className="text-[12px] font-mono text-neutral-400 uppercase tracking-wider mt-1">
            MANAGED PROJECTS & CODE REVIEW PIPELINES
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-none bg-[#FFE600] text-black border-2 border-black font-mono text-[12px] font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_#000000] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0px_0px_#000000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#000000] transition-all cursor-pointer"
        >
          <Plus size={16} strokeWidth={3} /> NEW PROJECT
        </button>
      </div>

      {/* Projects */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-black text-[#FFE600] border-2 border-black rounded-none shadow-[2px_2px_0px_0px_#000000]">
            <Briefcase size={16} strokeWidth={2.5} />
          </div>
          <h2 className="text-white font-mono font-black text-[14px] uppercase tracking-wider">
            // ACTIVE PROJECTS
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          {loading ? (
            <div className="text-neutral-500 font-mono text-[12px] py-8">// LOADING PROJECTS...</div>
          ) : projects.length === 0 ? (
            <div className="col-span-2 text-center py-16 text-neutral-400 font-mono text-[13px] border-2 border-dashed border-black bg-[#121417] rounded-none shadow-[4px_4px_0px_0px_#000000]">
              NO PROJECTS FOUND. <button onClick={openCreate} className="text-[#FFE600] hover:underline font-bold ml-1">CREATE ONE NOW.</button>
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
