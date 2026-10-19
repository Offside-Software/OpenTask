import { useState, useEffect, useCallback, useRef } from "react";
import type { Meeting, MeetingSource } from "../models";
import { meetingService } from "../services/meetingService";
import { useToast } from "../design-system/Toast";

export const useMeetings = (projectId: string | number) => {
  const { showToast } = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(
    (isCancelled: () => boolean = () => false) =>
      meetingService
        .getMeetingsByProject(projectId)
        .then((data) => {
          if (isCancelled()) return;
          setMeetings(data);
          setError(null);
          loadedRef.current = true;
        })
        .catch((err) => {
          if (isCancelled()) return;
          console.error(err);
          setError("Failed to fetch meetings");
          if (!loadedRef.current) showToast("Error loading meetings", "error");
        })
        .finally(() => {
          if (!isCancelled()) setLoading(false);
        }),
    [projectId, showToast],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const fetchMeetings = useCallback(() => load(), [load]);

  /** Re-reads one meeting and swaps it in; a meeting not in the list yet goes on top. */
  const refreshMeeting = useCallback(async (id: string | number) => {
    try {
      const fresh: Meeting = await meetingService.getMeeting(id);
      setMeetings((prev) => {
        const index = prev.findIndex((m) => String(m.id) === String(id));
        if (index === -1) return [fresh, ...prev];
        const next = prev.slice();
        next[index] = fresh;
        return next;
      });
    } catch (err) {
      console.error(err);
      setMeetings((prev) => prev.filter((m) => String(m.id) !== String(id)));
    }
  }, []);

  const removeMeetingLocally = useCallback((id: string | number) => {
    setMeetings((prev) => prev.filter((m) => String(m.id) !== String(id)));
  }, []);

  const createMeeting = useCallback(
    async (data: {
      project_id: number | string;
      title: string;
      date: string;
      time: string;
      duration?: string;
      source_type?: MeetingSource | string;
      mom_summary?: string;
      key_decisions?: string[];
      action_items?: unknown[];
    }) => {
      try {
        const created = await meetingService.createMeeting(data);
        setMeetings((prev) => [created, ...prev]);
        showToast("Meeting scheduled", "success");
        return created;
      } catch (err) {
        console.error(err);
        showToast("Failed to schedule meeting", "error");
        throw err;
      }
    },
    [showToast],
  );

  const deleteMeeting = useCallback(
    async (id: string | number) => {
      try {
        await meetingService.deleteMeeting(id);
        setMeetings((prev) => prev.filter((m) => String(m.id) !== String(id)));
        showToast("Meeting removed", "info");
      } catch (err) {
        showToast((err as Error).message || "Failed to delete meeting", "error");
      }
    },
    [showToast],
  );

  return {
    meetings,
    loading,
    error,
    createMeeting,
    deleteMeeting,
    refreshMeetings: fetchMeetings,
    refreshMeeting,
    removeMeetingLocally,
  };
};
