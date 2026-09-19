import { apiFetch } from './apiClient';
import type { PrReview } from '../models';

export interface GitHubPullRequest {
    repo_full_name: string;
    number: number;
    title: string;
    state: string;
    url: string;
    branch?: string;
    author?: string;
    created_at?: string;
    merged_at?: string;
}

export const prReviewService = {
    getProjectReviews: async (projectId: number | string): Promise<PrReview[]> => {
        return await apiFetch<PrReview[]>(`/projects/${projectId}/pr-reviews`);
    },

    getTaskReviews: async (taskId: number | string): Promise<PrReview[]> => {
        return await apiFetch<PrReview[]>(`/tasks/${taskId}/pr-reviews`);
    },

    triggerReview: async (
        projectId: number | string,
        params: { repo_full_name?: string; pr_number?: number; task_id?: number | string }
    ): Promise<PrReview> => {
        return await apiFetch<PrReview>(`/projects/${projectId}/pr-reviews/trigger`, {
            method: 'POST',
            body: JSON.stringify(params),
        });
    },

    syncProjectPrs: async (projectId: number | string): Promise<{ scanned: number; reviews_triggered: number; pull_requests: any[] }> => {
        return await apiFetch<{ scanned: number; reviews_triggered: number; pull_requests: any[] }>(
            `/projects/${projectId}/sync-prs`,
            { method: 'POST' }
        );
    },

    getProjectPulls: async (projectId: number | string): Promise<{ pull_requests: GitHubPullRequest[] }> => {
        return await apiFetch<{ pull_requests: GitHubPullRequest[] }>(`/projects/${projectId}/pulls`);
    },
};
