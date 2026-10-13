import { useState, useEffect, useCallback } from "react";
import type { ProjectMember } from "../models";
import { userService } from "../services/userService";

export const useProjectMembers = (projectId: string | number) => {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshMembers = useCallback(async () => {
    const data = await userService.getProjectMembers(projectId);
    setMembers(data);
    return data;
  }, [projectId]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      setLoading(true);
      try {
        const data = await refreshMembers();
        if (isMounted) {
          setMembers(data);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [refreshMembers]);

  return { members, loading, refreshMembers };
};
