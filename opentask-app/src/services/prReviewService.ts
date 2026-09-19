import { apiFetch } from './apiClient';
import type { PrReview } from '../models';

export const prReviewService = {
    getProjectReviews: async (projectId: number | string): Promise<PrReview[]> => {
        return await apiFetch<PrReview[]>(`/projects/${projectId}/pr-reviews`);
    },

    getTaskReviews: async (taskId: number | string): Promise<PrReview[]> => {
        return await apiFetch<PrReview[]>(`/tasks/${taskId}/pr-reviews`);
    },
};
