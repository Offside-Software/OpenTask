import { useEffect, useRef } from "react";
import {
  apiFetch,
  clearPendingGetRequests,
  getStoredToken,
  resolveRealtimeUrl,
} from "../services/apiClient";

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
    let preferTokenFallback = false;

    const connect = async () => {
      if (stopped) return;

      const token = getStoredToken();
      if (!token) {
        reconnectTimer = setTimeout(connect, MAX_RECONNECT_DELAY);
        return;
      }

      // Request a short-lived one-time ticket to avoid leaking access tokens in URL query params
      let ticket: string | null = null;
      if (!preferTokenFallback) {
        try {
          const ticketRes = await apiFetch<{ ticket: string }>(
            `/projects/${projectId}/events/ticket`,
            { method: "POST" },
          );
          ticket = ticketRes.ticket;
        } catch (err) {
          console.warn("Failed to acquire WebSocket one-time ticket, falling back to query token:", err);
        }
      }

      if (stopped) return;

      const wsUrl = resolveRealtimeUrl(`/projects/${projectId}/events`);
      const usedTicket = Boolean(ticket);
      if (ticket) {
        wsUrl.searchParams.set("ticket", ticket);
      } else {
        wsUrl.searchParams.set("token", token);
      }

      let opened = false;
      socket = new WebSocket(wsUrl.toString());
      socket.onopen = () => {
        opened = true;
        preferTokenFallback = false;
        reconnectDelay = 1_000;
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as ProjectEvent;
          if (String(event.project_id) === String(projectId)) {
            clearPendingGetRequests();
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
        // If handshake with a one-time ticket failed before opening (e.g. multi-instance load balancer),
        // retry immediately using the direct token fallback.
        if (!opened && usedTicket && !preferTokenFallback) {
          preferTokenFallback = true;
          reconnectTimer = setTimeout(connect, 300);
          return;
        }
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
