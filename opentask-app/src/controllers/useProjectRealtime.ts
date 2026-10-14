import { useEffect, useRef } from "react";
import { apiFetch, getStoredToken, resolveApiUrl } from "../services/apiClient";

export interface ProjectEvent {
  version: number;
  project_id: string;
  entity: "task" | "bucket" | "project" | "member" | string;
  action: string;
  entity_id?: string;
}

interface UseProjectRealtimeOptions {
  onEvent: (event: ProjectEvent) => void;
}

const MAX_RECONNECT_DELAY = 30_000;

export const useProjectRealtime = (
  projectId: string | number,
  { onEvent }: UseProjectRealtimeOptions,
) => {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!projectId || typeof window === "undefined") return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectDelay = 1_000;
    let stopped = false;

    const connect = async () => {
      if (stopped) return;

      const token = getStoredToken();
      if (!token) {
        reconnectTimer = setTimeout(connect, MAX_RECONNECT_DELAY);
        return;
      }

      // Request a short-lived one-time ticket to avoid leaking access tokens in URL query params
      let ticket: string | null = null;
      try {
        const ticketRes = await apiFetch<{ ticket: string }>(
          `/projects/${projectId}/events/ticket`,
          { method: "POST" }
        );
        ticket = ticketRes.ticket;
      } catch (err) {
        console.warn("Failed to acquire WebSocket one-time ticket, falling back to query token:", err);
      }

      if (stopped) return;

      const httpUrl = new URL(
        resolveApiUrl(`/projects/${projectId}/events`),
        window.location.origin,
      );
      httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
      if (ticket) {
        httpUrl.searchParams.set("ticket", ticket);
      } else {
        httpUrl.searchParams.set("token", token);
      }

      socket = new WebSocket(httpUrl.toString());
      socket.onopen = () => {
        reconnectDelay = 1_000;
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as ProjectEvent;
          if (String(event.project_id) === String(projectId)) {
            onEventRef.current(event);
          }
        } catch (error) {
          console.error("Failed to parse project realtime event:", error);
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
      socket.onclose = () => {
        if (stopped) return;
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [projectId]);
};
