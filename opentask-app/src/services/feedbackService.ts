import { apiFetch } from './apiClient';
import type { Feedback, CreateFeedbackInput, FeedbackStatus } from '../models';

export interface FeedbackQueryParams {
  status?: string;
  feedback_type?: string;
  limit?: number;
  offset?: number;
}

export const feedbackService = {
  async submitFeedback(input: CreateFeedbackInput): Promise<Feedback> {
    return apiFetch<Feedback>('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  },

  async getFeedbacks(params: FeedbackQueryParams = {}): Promise<Feedback[]> {
    const searchParams = new URLSearchParams();
    if (params.status) searchParams.set('status', params.status);
    if (params.feedback_type) searchParams.set('feedback_type', params.feedback_type);
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.offset !== undefined) searchParams.set('offset', String(params.offset));

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/api/feedback?${queryString}` : '/api/feedback';
    return apiFetch<Feedback[]>(endpoint);
  },

  async getFeedbackById(id: string): Promise<Feedback> {
    return apiFetch<Feedback>(`/api/feedback/${id}`);
  },

  async updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<Feedback> {
    return apiFetch<Feedback>(`/api/feedback/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });
  },

  async deleteFeedback(id: string): Promise<{ success: boolean; message: string }> {
    return apiFetch<{ success: boolean; message: string }>(`/api/feedback/${id}`, {
      method: 'DELETE',
    });
  },
};
