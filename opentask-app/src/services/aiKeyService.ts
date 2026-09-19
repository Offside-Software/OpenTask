import { apiFetch } from "./apiClient";

export interface TestKeyResponse {
  valid: boolean;
  model: string;
  error?: string | null;
}

export interface ProjectAiKeyResponse {
  project_id: string;
  has_custom_key: boolean;
  masked_key?: string | null;
  status?: string;
}

export interface UserAiKeyResponse {
  user_id: string;
  has_custom_key: boolean;
  masked_key?: string | null;
  status?: string;
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
    return apiFetch<ProjectAiKeyResponse>(`/projects/${projectId}/ai-key`);
  },

  /**
   * Save or update project-level custom AI API key.
   */
  saveProjectAiKey: async (
    projectId: string | number,
    apiKey: string,
    validateFirst: boolean = true
  ): Promise<ProjectAiKeyResponse> => {
    return apiFetch<ProjectAiKeyResponse>(`/projects/${projectId}/ai-key`, {
      method: "POST",
      body: JSON.stringify({
        api_key: apiKey,
        validate_first: validateFirst,
      }),
    });
  },

  /**
   * Delete/clear project-level custom AI API key (falls back to user/system key).
   */
  deleteProjectAiKey: async (projectId: string | number): Promise<{ project_id: string; status: string; has_custom_key: boolean }> => {
    return apiFetch<{ project_id: string; status: string; has_custom_key: boolean }>(
      `/projects/${projectId}/ai-key`,
      {
        method: "DELETE",
      }
    );
  },

  /**
   * Retrieve user-level personal AI API key status and masked representation.
   */
  getUserAiKey: async (): Promise<UserAiKeyResponse> => {
    return apiFetch<UserAiKeyResponse>("/users/me/ai-key");
  },

  /**
   * Save or update user-level personal AI API key.
   */
  saveUserAiKey: async (
    apiKey: string,
    validateFirst: boolean = true
  ): Promise<UserAiKeyResponse> => {
    return apiFetch<UserAiKeyResponse>("/users/me/ai-key", {
      method: "POST",
      body: JSON.stringify({
        api_key: apiKey,
        validate_first: validateFirst,
      }),
    });
  },

  /**
   * Delete/clear user-level personal AI API key.
   */
  deleteUserAiKey: async (): Promise<{ user_id: string; status: string; has_custom_key: boolean }> => {
    return apiFetch<{ user_id: string; status: string; has_custom_key: boolean }>(
      "/users/me/ai-key",
      {
        method: "DELETE",
      }
    );
  },
};
