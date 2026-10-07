import { apiFetch } from "./apiClient";

export interface TestKeyResponse {
  valid: boolean;
  model: string;
  error?: string | null;
}

export interface ProjectAiKeyResponse {
  project_id: string;
  has_custom_key: boolean;
  has_key?: boolean;
  masked_key?: string | null;
  status?: string;
  source?: string;
}

export interface UserAiKeyResponse {
  user_id: string;
  has_custom_key: boolean;
  has_key?: boolean;
  masked_key?: string | null;
  status?: string;
  source?: string;
}

export const aiKeyService = {
  /**
   * Test if a Google Gemini API key is valid and working.
   */
  testApiKey: async (apiKey: string): Promise<TestKeyResponse> => {
    return apiFetch<TestKeyResponse>("/ai/test-key", {
      method: "POST",
      body: JSON.stringify({ api_key: apiKey }),
    });
  },

  /**
   * Retrieve project-level custom AI API key status and masked representation.
   */
  getProjectAiKey: async (projectId: string | number): Promise<ProjectAiKeyResponse> => {
    const res = await apiFetch<any>(`/projects/${projectId}/ai-key`);
    const hasKey = Boolean(res?.has_custom_key || res?.has_key || res?.masked_key);
    return {
      project_id: String(projectId),
      has_custom_key: hasKey,
      has_key: hasKey,
      masked_key: res?.masked_key || null,
      source: res?.source || (hasKey ? "project" : "none"),
      status: res?.status,
    };
  },

  /**
   * Save or update project-level custom AI API key.
   */
  saveProjectAiKey: async (
    projectId: string | number,
    apiKey: string,
    validateFirst: boolean = true
  ): Promise<ProjectAiKeyResponse> => {
    await apiFetch(`/projects/${projectId}/ai-key`, {
      method: "POST",
      body: JSON.stringify({
        api_key: apiKey,
        validate_first: validateFirst,
      }),
    });
    return await aiKeyService.getProjectAiKey(projectId);
  },

  /**
   * Delete/clear project-level custom AI API key (falls back to user/system key).
   */
  deleteProjectAiKey: async (projectId: string | number): Promise<{ project_id: string; status: string; has_custom_key: boolean }> => {
    const res = await apiFetch<any>(
      `/projects/${projectId}/ai-key`,
      {
        method: "DELETE",
      }
    );
    return {
      project_id: String(projectId),
      status: res?.status || "deleted",
      has_custom_key: false,
    };
  },

  /**
   * Retrieve user-level personal AI API key status and masked representation.
   */
  getUserAiKey: async (): Promise<UserAiKeyResponse> => {
    const res = await apiFetch<any>("/users/me/ai-key");
    const hasKey = Boolean(res?.has_custom_key || res?.has_key || res?.masked_key);
    return {
      user_id: res?.user_id || "",
      has_custom_key: hasKey,
      has_key: hasKey,
      masked_key: res?.masked_key || null,
      source: res?.source || (hasKey ? "user" : "none"),
      status: res?.status,
    };
  },

  /**
   * Save or update user-level personal AI API key.
   */
  saveUserAiKey: async (
    apiKey: string,
    validateFirst: boolean = true
  ): Promise<UserAiKeyResponse> => {
    await apiFetch("/users/me/ai-key", {
      method: "POST",
      body: JSON.stringify({
        api_key: apiKey,
        validate_first: validateFirst,
      }),
    });
    return await aiKeyService.getUserAiKey();
  },

  /**
   * Delete/clear user-level personal AI API key.
   */
  deleteUserAiKey: async (): Promise<{ user_id: string; status: string; has_custom_key: boolean }> => {
    const res = await apiFetch<any>(
      "/users/me/ai-key",
      {
        method: "DELETE",
      }
    );
    return {
      user_id: res?.user_id || "",
      status: res?.status || "deleted",
      has_custom_key: false,
    };
  },
};
