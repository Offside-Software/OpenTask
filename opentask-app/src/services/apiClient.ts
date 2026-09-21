import JSONBig from "json-bigint";

export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export function resolveApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  if (BASE_URL) {
    const cleanBase = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
    return `${cleanBase}${cleanEndpoint}`;
  }

  // In standard browser environment (both local dev and prod):
  // Ensure the endpoint starts with /api so Vite proxy (dev) and Vercel (prod) route it to FastAPI:
  if (cleanEndpoint.startsWith("/api/")) {
    return cleanEndpoint;
  }

  return `/api${cleanEndpoint}`;
}

// Map to cleanly deduplicate concurrent identical GET requests
const pendingGetRequests = new Map<string, Promise<unknown>>();

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = resolveApiUrl(endpoint);

  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") {
    pendingGetRequests.clear();
  }
  const cacheKey = method === "GET" ? url : null;

  // Deduplicate identical simultaneous GET requests to prevent "multiple getter" loops and StrictMode duplicate calls
  if (cacheKey && pendingGetRequests.has(cacheKey)) {
    return pendingGetRequests.get(cacheKey) as Promise<T>;
  }

  const defaultHeaders = {
    "Content-Type": "application/json",
  };

  const config = {
    ...options,
    credentials: options.credentials || "include",
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  const fetchPromise = (async () => {
    let attempts = 0;
    const isIdempotent = ["GET", "HEAD", "PUT", "DELETE"].includes(method);
    const maxAttempts = isIdempotent ? 2 : 1;

    try {
      while (attempts < maxAttempts) {
        attempts++;
        try {
          const response = await fetch(url, config);

          if (!response.ok) {
            // If server error on idempotent request (e.g. cold start / pooler reset), retry once before failing
            if (attempts < maxAttempts && isIdempotent && response.status >= 500 && response.status <= 504) {
              await new Promise((res) => setTimeout(res, 350));
              continue;
            }

            let errorData: Record<string, unknown> = {};
            try {
              const text = await response.text();
              errorData = text ? JSONBig({ storeAsString: true }).parse(text) : {};
            } catch {
              // ignore parsing error for error bodies
            }

            throw new Error(
              (errorData.detail as string) ||
              `API Error: ${response.status} ${response.statusText}`,
            );
          }

          const text = await response.text();
          return (text ? JSONBig({ storeAsString: true }).parse(text) : {}) as T;
        } catch (error) {
          if (attempts < maxAttempts && isIdempotent) {
            await new Promise((res) => setTimeout(res, 350));
            continue;
          }
          console.error(`Fetch error at ${url}:`, error);
          throw error;
        }
      }
      throw new Error(`Request failed after ${attempts} attempts`);
    } finally {
      // Remove from pending map shortly after resolving to allow for minor timing discrepancies
      // e.g React StrictMode or slightly delayed sibling component mounts.
      if (cacheKey) {
        setTimeout(() => pendingGetRequests.delete(cacheKey), 100);
      }
    }
  })();

  if (cacheKey) {
    pendingGetRequests.set(cacheKey, fetchPromise);
  }

  return fetchPromise;
}
