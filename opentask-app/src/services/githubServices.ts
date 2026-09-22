import type { GithubInstallation, GithubInstallationRepo } from '../models';
import { resolveApiUrl } from './apiClient';

export interface GithubUserSearchResult {
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GithubRepoSearchResult {
  full_name: string;
  private: boolean;
  html_url: string;
}

export const searchGithubUsers = async (query: string): Promise<GithubUserSearchResult[]> => {
  const normalized = query.trim();
  if (normalized.length < 2) return [];

  const resp = await fetch(resolveApiUrl(`/github/users/search?query=${encodeURIComponent(normalized)}`), {
    credentials: 'include',
  });

  if (!resp.ok) {
    const message = await resp.text();
    throw new Error(message || `GitHub user search failed with ${resp.status}`);
  }

  const payload = (await resp.json()) as { items: GithubUserSearchResult[] };
  return payload.items ?? [];
};

export const searchGithubRepositories = async (query: string): Promise<GithubRepoSearchResult[]> => {
  const normalized = query.trim();
  if (normalized.length < 2) return [];

  const resp = await fetch(resolveApiUrl(`/github/repos/search?query=${encodeURIComponent(normalized)}`), {
    credentials: 'include',
  });

  if (!resp.ok) {
    const message = await resp.text();
    throw new Error(message || `GitHub repository search failed with ${resp.status}`);
  }

  const payload = (await resp.json()) as { items: GithubRepoSearchResult[] };
  return payload.items ?? [];
};

export const getGithubInstallations = async (): Promise<{
  installations: GithubInstallation[];
}> => {
  const resp = await fetch(resolveApiUrl('/github/installations'), {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`Failed to list GitHub installations: ${resp.status}`);
  return resp.json();
};

export const getInstallationRepos = async (installationId: number): Promise<{
  repos: GithubInstallationRepo[];
}> => {
  const resp = await fetch(resolveApiUrl(`/github/installations/${installationId}/repos`), {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`Failed to list repos for installation ${installationId}: ${resp.status}`);
  return resp.json();
};

export const getProjectRepos = async (projectId: string | number): Promise<{
  repos: GithubInstallationRepo[];
  connected_urls: string[];
}> => {
  const resp = await fetch(resolveApiUrl(`/projects/${projectId}/repos`), {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`Failed to get project repos: ${resp.status}`);
  return resp.json();
};

export const getGithubAppInstallUrl = async (): Promise<string> => {
  const resp = await fetch(resolveApiUrl('/github/app/install-url'), {
    credentials: 'include',
  });
  if (!resp.ok) return 'https://github.com/apps';
  const data = await resp.json();
  return data.install_url;
};

export const linkInstallationToProject = async (
  projectId: string | number,
  installationId: number,
  accountLogin: string,
  accountType: string,
): Promise<void> => {
  const resp = await fetch(resolveApiUrl(`/projects/${projectId}/installations`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      installation_id: installationId,
      account_login: accountLogin,
      account_type: accountType,
    }),
  });
  if (!resp.ok) throw new Error(`Failed to link installation: ${resp.status}`);
};

export const unlinkInstallationFromProject = async (
  projectId: string | number,
  installationId: number,
): Promise<void> => {
  const resp = await fetch(resolveApiUrl(`/projects/${projectId}/installations/${installationId}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(`Failed to unlink installation: ${resp.status}`);
};
