import { apiFetch } from "./apiClient";
import type { Meeting } from "../models";

export const meetingService = {
  getMeetingsByProject: async (projectId: string | number): Promise<Meeting[]> => {
    return await apiFetch<Meeting[]>(`/meetings/project/${projectId}`);
  },

  createMeeting: async (meetingData: unknown): Promise<Meeting> => {
    return await apiFetch<Meeting>("/meetings", {
      method: "POST",
      body: JSON.stringify(meetingData),
      headers: { "Content-Type": "application/json" },
    });
  },

  deleteMeeting: async (meetingId: string | number): Promise<void> => {
    await apiFetch(`/meetings/${meetingId}`, { method: "DELETE" });
  },
};
