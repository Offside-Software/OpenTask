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

  const getProjectName = (id: number) => allProjects.find(p => p.id === id)?.name || `Project #${id}`;

  return (
    <>
      <SurfaceCard 
        title="Urgent Actions" 
        icon={AlertCircle} 
        className={className} 
        rightElement={loading ? <Skeleton width={60} height={18} /> : (alerts.length > 0 ? <Badge variant="danger">{alerts.length} Items</Badge> : null)}
      >
        <div className="space-y-2.5 flex-1 overflow-y-auto no-scrollbar pr-1 min-h-0">
          {loading ? (
            [1, 2, 3].map(i => (
              <div key={i} className="p-3.5 rounded-lg bg-card/60 border border-border flex justify-between items-center">
                <div className="flex-1">
                  <Skeleton width="25%" height={10} className="mb-2" />
                  <Skeleton width="80%" height={14} className="mb-2" />
                  <Skeleton width="40%" height={10} />
                </div>
                <Skeleton variant="circle" width={20} height={20} className="ml-4" />
              </div>
            ))
          ) : alerts.length === 0 ? (
            <div className="text-muted-foreground text-xs py-8 text-center border border-dashed border-border rounded-xl">
              No critical actions pending
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id!}
                onClick={() => setSelectedAlert(alert)}
                className={`p-3.5 rounded-lg border bg-card/50 hover:bg-accent/40 group cursor-pointer transition-all flex justify-between items-center ${
                  alert.severity === 'critical' 
                    ? 'border-destructive/30 hover:border-destructive/60' 
                    : 'border-amber-500/30 hover:border-amber-500/60'
                }`}
              >
                <div>
                  <Badge variant={alert.severity === 'critical' ? 'danger' : 'warning'} className="py-0.5 px-1.5 text-[10px]">
                    {alert.severity}
                  </Badge>
                  <h5 className="text-foreground font-medium text-xs mt-1.5 line-clamp-1">{alert.title}</h5>
                  <p className="text-muted-foreground text-[11px] mt-0.5">{getProjectName(Number(alert.project_id))}</p>
                </div>
                <div className="w-6 h-6 rounded-md border border-border flex items-center justify-center text-muted-foreground group-hover:text-primary-foreground group-hover:bg-primary group-hover:border-primary transition-all shrink-0">
                  <ChevronRight size={14} />
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
