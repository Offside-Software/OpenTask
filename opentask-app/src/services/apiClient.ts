import JSONBig from "json-bigint";

export function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    const override = localStorage.getItem("opentask_api_url");
    if (override && override.trim()) {
      return override.trim();
    }
  }
  return (
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    ""
  ).trim();
}

export const BASE_URL = getBaseUrl();

export function resolveApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const baseUrl = getBaseUrl();

  if (baseUrl) {
    const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

    // Prevent duplicate /api when cleanBase ends with /api and cleanEndpoint also starts with /api/
    if (cleanBase.endsWith("/api") && cleanEndpoint.startsWith("/api/")) {
      return `${cleanBase}${cleanEndpoint.slice(4)}`;
    }

    return `${cleanBase}${cleanEndpoint}`;
  }

  // In standard browser environment (both local dev and prod without explicit base URL):
  // Ensure the endpoint starts with /api so Vite proxy (dev) and Vercel rewrites (prod) route it to backend:
  if (cleanEndpoint.startsWith("/api/")) {
    return cleanEndpoint;
  }

  return `/api${cleanEndpoint}`;
}

export function getStoredToken(): string | null {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      localStorage.setItem("gh_token", urlToken);
      params.delete("token");
      const newQuery = params.toString() ? `?${params.toString()}` : "";
      window.history.replaceState({}, document.title, `${window.location.pathname}${newQuery}`);
      return urlToken;
    }
    return localStorage.getItem("gh_token");
  }
  return null;
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

  const token = getStoredToken();
  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
