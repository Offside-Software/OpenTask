import { useState, useEffect } from "react";
import { projectMemberService } from "../services/projectMemberService";
import { getCached, setCached } from "../utils/cache";

export const useCurrentUserRole = (
  projectId: string | number | null,
  userId: number | string | undefined,
) => {
  const cacheKey = projectId && userId ? `opentask_role_${projectId}_${userId}` : null;
  const initialRole = cacheKey ? getCached<string>(cacheKey) : null;

  const [role, setRole] = useState<string | null>(initialRole);
  const [loading, setLoading] = useState<boolean>(!initialRole);

  useEffect(() => {
    if (!projectId || !userId) {
      setRole(null);
      setLoading(false);
      return;
    }

    const cached = getCached<string>(`opentask_role_${projectId}_${userId}`);
    if (cached) {
      setRole(cached);
      setLoading(false);
    }

    const fetchRole = async () => {
      if (!cached) setLoading(true);
      try {
        const members = await projectMemberService.getMembers(projectId);
        const member = members.find(
          (m: { user_id: number | string; role?: string }) => String(m.user_id) === String(userId),
        );
        const resolvedRole = member?.role || null;
        setRole(resolvedRole);
        setCached(`opentask_role_${projectId}_${userId}`, resolvedRole);
      } catch (err) {
        console.error("Failed to fetch role:", err);
        setRole(null);
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [projectId, userId]);

  return { role, loading };
};
