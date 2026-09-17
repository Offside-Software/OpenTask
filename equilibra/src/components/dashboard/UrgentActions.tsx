import React, { useState } from 'react';
import { AlertCircle, ChevronRight } from 'lucide-react';
import { SurfaceCard } from '../../design-system/SurfaceCard';
import { Badge } from '../../design-system/Badge';
import { useAlerts } from '../../controllers/useAlerts';
import { AlertDetailModal } from '../modals/AlertDetailModal';
import { useProjects } from '../../controllers/useProjects';
import type { Alert } from '../../models';
import { Skeleton } from '../../design-system/Skeleton';

interface UrgentActionsProps {
  onNavigateProject: (id: number) => void;
  className?: string;
}

export const UrgentActions: React.FC<UrgentActionsProps> = ({ onNavigateProject, className = "" }) => {
  const { alerts, loading, resolveAlert } = useAlerts();
  const { leadProjects, collaboratingProjects } = useProjects();
  const allProjects = [...leadProjects, ...collaboratingProjects];

  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);

  const getProjectName = (id: number) => allProjects.find(p => p.id === id)?.name || `PROJECT #${id}`;

  return (
    <>
      <SurfaceCard 
        title="URGENT ACTIONS" 
        icon={AlertCircle} 
        className={className} 
        rightElement={loading ? <Skeleton width={60} height={18} /> : (alerts.length > 0 ? <Badge variant="critical">{alerts.length} ITEMS</Badge> : null)}
      >
        <div className="space-y-2.5 flex-1 overflow-y-auto no-scrollbar pr-1 min-h-0">
          {loading ? (
            [1, 2, 3].map(i => (
              <div key={i} className="p-3.5 rounded-none bg-[#1E2227] border-2 border-black flex justify-between items-center">
                <div className="flex-1">
                  <Skeleton width="25%" height={10} className="mb-2" />
                  <Skeleton width="80%" height={14} className="mb-2" />
                  <Skeleton width="40%" height={10} />
                </div>
                <Skeleton variant="circle" width={20} height={20} className="ml-4" />
              </div>
            ))
          ) : alerts.length === 0 ? (
            <div className="text-neutral-500 font-mono text-[11px] py-8 text-center border-2 border-dashed border-neutral-700 rounded-none uppercase">
              // NO CRITICAL ACTIONS PENDING
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id!}
                onClick={() => setSelectedAlert(alert)}
                className={`p-3.5 rounded-none bg-[#141619] border-2 group cursor-pointer transition-all duration-75 flex justify-between items-center ${
                  alert.severity === 'critical' 
                    ? 'border-[#FF3333] hover:bg-[#FF3333]/10 shadow-[3px_3px_0px_0px_#FF3333]' 
                    : 'border-[#FFE600] hover:bg-[#FFE600]/10 shadow-[3px_3px_0px_0px_#FFE600]'
                }`}
              >
                <div>
                  <Badge variant={alert.severity === 'critical' ? 'critical' : 'warning'} className="!py-0.2 !px-1.5 !text-[9px]">
                    {alert.severity}
                  </Badge>
                  <h5 className="text-white font-bold text-[13px] mt-1.5 line-clamp-1">{alert.title}</h5>
                  <p className="text-neutral-400 font-mono text-[10px] mt-0.5 uppercase">{getProjectName(Number(alert.project_id))}</p>
                </div>
                <div className="w-6 h-6 rounded-none border border-neutral-700 flex items-center justify-center text-neutral-400 group-hover:text-black group-hover:bg-[#FFE600] group-hover:border-black transition-all flex-shrink-0">
                  <ChevronRight size={14} strokeWidth={3} />
                </div>
              </div>
            ))
          )}
        </div>
      </SurfaceCard>

      {selectedAlert && (
        <AlertDetailModal
          alert={selectedAlert}
          projectName={getProjectName(Number(selectedAlert.project_id))}
          onClose={() => setSelectedAlert(null)}
          onNavigate={() => {
            onNavigateProject(Number(selectedAlert.project_id));
            setSelectedAlert(null);
          }}
          onResolve={async () => {
            await resolveAlert(selectedAlert.id!);
            setSelectedAlert(null);
          }}
        />
      )}
    </>
  );
};
