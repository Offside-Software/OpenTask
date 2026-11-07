import React, { useState, useEffect } from 'react';
import {
  MessageSquarePlus,
  Bug,
  Lightbulb,
  Sparkles,
  Star,
  Send,
  CheckCircle2,
  AlertCircle,
  Inbox,
  RefreshCw,
  Trash2,
  Check,
  Monitor,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { feedbackService } from '../../services/feedbackService';
import type { Feedback, FeedbackType, FeedbackStatus, CreateFeedbackInput } from '../../models';
import { CloseButton } from '../../design-system/CloseButton';
import { Button } from '../../design-system/Button';
import { Badge } from '../../design-system/Badge';
import { ConfirmModal } from './ConfirmModal';
import { cn } from '@/lib/utils';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'submit' | 'review';
}

const FEEDBACK_TYPES: { type: FeedbackType; label: string; icon: React.ElementType }[] = [
  { type: 'FEEDBACK', label: 'Feedback', icon: MessageSquarePlus },
  { type: 'BUG', label: 'Bug Report', icon: Bug },
  { type: 'FEATURE', label: 'Feature Idea', icon: Lightbulb },
  { type: 'GENERAL', label: 'Alpha Review', icon: Sparkles },
];

const CATEGORIES = ['GENERAL', 'UI/UX', 'PERFORMANCE', 'WORKSPACES', 'NOTIFICATIONS', 'MCP/AGENT'];

const RATING_LABELS: Record<number, string> = {
  1: '1/5 - Poor / Frustrating',
  2: '2/5 - Fair / Needs Polish',
  3: '3/5 - Good / Usable',
  4: '4/5 - Very Good / Smooth',
  5: '5/5 - Outstanding / Alpha Ready!',
};

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'submit',
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'submit' | 'review'>(defaultTab);

  const isDev = Boolean(
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.endsWith('.localhost')))
  );

  const [feedbackType, setFeedbackType] = useState<FeedbackType>('FEEDBACK');
  const [category, setCategory] = useState<string>('GENERAL');
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [includeDeviceInfo, setIncludeDeviceInfo] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isLoadingFeedbacks, setIsLoadingFeedbacks] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [feedbackToDelete, setFeedbackToDelete] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      setSubmitSuccess(false);
      setErrorMessage(null);
      if (defaultTab === 'review') {
        loadFeedbacks();
      }
    }
  }, [isOpen, defaultTab]);

  useEffect(() => {
    if (isOpen && activeTab === 'review') {
      loadFeedbacks();
    }
  }, [isOpen, activeTab, statusFilter, typeFilter]);

  const loadFeedbacks = async () => {
    setIsLoadingFeedbacks(true);
    try {
      const params: { status?: string; feedback_type?: string } = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (typeFilter !== 'ALL') params.feedback_type = typeFilter;
      const data = await feedbackService.getFeedbacks(params);
      setFeedbacks(data);
    } catch (err: any) {
      console.error('Failed to load feedbacks:', err);
    } finally {
      setIsLoadingFeedbacks(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setErrorMessage('Please provide a description or detail for your feedback.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const deviceInfo = includeDeviceInfo
      ? {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        path: window.location.pathname,
        timestamp: new Date().toISOString(),
      }
      : {};

    const payload: CreateFeedbackInput = {
      feedback_type: feedbackType,
      category,
      rating,
      title: title.trim() || undefined,
      description: description.trim(),
      user_name: user?.name || user?.login || 'Anonymous Alpha Tester',
      user_email: user?.email || undefined,
      device_info: deviceInfo,
    };

    try {
      await feedbackService.submitFeedback(payload);
      setSubmitSuccess(true);
      setTitle('');
      setDescription('');
      setTimeout(() => {
        setSubmitSuccess(false);
        setActiveTab('review');
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: FeedbackStatus) => {
    setActionInProgress(id);
    try {
      await feedbackService.updateFeedbackStatus(id, newStatus);
      setFeedbacks(prev =>
        prev.map(item => (item.id === id ? { ...item, status: newStatus } : item))
      );
    } catch (err) {
      console.error('Failed to update status:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const executeDelete = async (id: string) => {
    setActionInProgress(id);
    try {
      await feedbackService.deleteFeedback(id);
      setFeedbacks(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      console.error('Failed to delete feedback:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const getStatusBadgeVariant = (status: FeedbackStatus): 'warning' | 'default' | 'success' | 'critical' => {
    switch (status) {
      case 'PENDING':
        return 'warning';
      case 'REVIEWED':
        return 'default';
      case 'RESOLVED':
        return 'success';
      case 'DISMISSED':
        return 'critical';
      default:
        return 'default';
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-xs select-none animate-in fade-in duration-150">
        <div
          className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 max-h-[90vh]"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-border flex justify-between items-center bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <MessageSquarePlus size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-foreground text-base font-semibold">
                    User Feedback & Report
                  </h2>
                  <span className="bg-primary/10 text-primary text-[10px] font-medium px-2 py-0.5 rounded-full">
                    Alpha
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Shape the OpenTask experience
                </p>
              </div>
            </div>
            <CloseButton onClick={onClose} size="md" />
          </div>

          {/* Tab Switcher */}
          <div className="grid grid-cols-2 border-b border-border bg-muted/30 p-1 gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('submit')}
              className={cn(
                "py-2 px-3 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer",
                activeTab === 'submit'
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Send size={14} />
              <span>Submit Feedback</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('review')}
              className={cn(
                "py-2 px-3 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer",
                activeTab === 'review'
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Inbox size={14} />
              <span>Review Feedbacks</span>
              {feedbacks.length > 0 && (
                <span className="ml-1 text-[10px] bg-primary/15 text-primary px-1.5 py-0.2 rounded-full font-medium">
                  {feedbacks.length}
                </span>
              )}
            </button>
          </div>

          {/* Content Body */}
          <div className="p-4 sm:p-6 overflow-y-auto no-scrollbar max-h-[70vh]">
            {activeTab === 'submit' ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                {submitSuccess && (
                  <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium rounded-lg flex items-center gap-2 shadow-xs">
                    <CheckCircle2 size={16} />
                    <span>Thank you! Feedback received and saved.</span>
                  </div>
                )}

                {errorMessage && (
                  <div className="p-3 bg-destructive/15 border border-destructive/30 text-destructive text-xs font-medium rounded-lg flex items-center gap-2 shadow-xs">
                    <AlertCircle size={16} />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Type Selection */}
                <div>
                  <label className="text-foreground text-xs font-medium mb-1.5 block">
                    Category
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {FEEDBACK_TYPES.map(({ type, label, icon: Icon }) => {
                      const isSelected = feedbackType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFeedbackType(type)}
                          className={cn(
                            "p-2.5 rounded-lg border text-center flex flex-col items-center gap-1.5 cursor-pointer transition-colors shadow-xs",
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon size={16} />
                          <span className="text-xs font-medium">
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Rating */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-foreground text-xs font-medium block">
                      Experience Rating
                    </label>
                    <span className="text-xs text-primary font-medium">
                      {RATING_LABELS[hoverRating || rating]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 bg-muted/30 p-2.5 rounded-lg border border-border">
                    {[1, 2, 3, 4, 5].map(val => {
                      const activeVal = hoverRating || rating;
                      const isFilled = val <= activeVal;
                      return (
                        <button
                          key={val}
                          type="button"
                          onMouseEnter={() => setHoverRating(val)}
                          onMouseLeave={() => setHoverRating(0)}
                          onClick={() => setRating(val)}
                          className="cursor-pointer p-1 transition-transform hover:scale-110 active:scale-95"
                        >
                          <Star
                            size={20}
                            className={cn(
                              isFilled
                                ? "text-amber-500 fill-amber-500"
                                : "text-muted-foreground/40 hover:text-amber-400"
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Module Area */}
                <div>
                  <label className="text-foreground text-xs font-medium mb-1.5 block">
                    Subsystem Area
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORIES.map(cat => {
                      const isSelected = category === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCategory(cat)}
                          className={cn(
                            "px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer shadow-xs",
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Title Input */}
                <div>
                  <label className="text-foreground text-xs font-medium mb-1.5 block">
                    Summary Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Kanban drag drop glitch, or AI prompt suggestion..."
                    className="w-full bg-background border border-input rounded-lg p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-foreground text-xs font-medium mb-1.5 block">
                    Detailed Feedback / Bug Reproduction
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Describe your experience, what happened, expected behavior, or ideas to improve OpenTask..."
                    className="w-full bg-background border border-input rounded-lg p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring shadow-xs transition-colors resize-none leading-relaxed"
                  />
                </div>

                {/* Telemetry Toggle */}
                <div className="bg-muted/30 border border-border rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Monitor size={15} className="text-primary" />
                    <span className="text-muted-foreground text-xs">
                      Include browser & screen telemetry for bug triage
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={includeDeviceInfo}
                    onChange={e => setIncludeDeviceInfo(e.target.checked)}
                    className="w-4 h-4 rounded text-primary cursor-pointer accent-purple-600"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2.5 justify-end pt-3 border-t border-border">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onClose}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSubmitting || !description.trim()}
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Submitting…</span>
                      </>
                    ) : (
                      <>
                        <Send size={13} />
                        <span>Submit feedback</span>
                      </>
                    )}
                  </Button>
                </div>
              </form>
            ) : (
              /* Review Feedbacks Tab */
              <div className="space-y-4">
                {/* Filter Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-muted/30 border border-border rounded-xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-medium">Filter:</span>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="bg-background text-foreground border border-input rounded-md text-xs px-2 py-1 outline-none font-medium cursor-pointer shadow-xs"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="PENDING">Pending</option>
                      <option value="REVIEWED">Reviewed</option>
                      <option value="RESOLVED">Resolved</option>
                    </select>

                    <select
                      value={typeFilter}
                      onChange={e => setTypeFilter(e.target.value)}
                      className="bg-background text-foreground border border-input rounded-md text-xs px-2 py-1 outline-none font-medium cursor-pointer shadow-xs"
                    >
                      <option value="ALL">All Types</option>
                      <option value="FEEDBACK">Feedback</option>
                      <option value="BUG">Bug Reports</option>
                      <option value="FEATURE">Features</option>
                      <option value="GENERAL">Alpha Reviews</option>
                    </select>

                    {isDev && (
                      <span className="text-[10px] bg-primary/10 text-primary font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                        <ShieldAlert size={11} /> Dev controls active
                      </span>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadFeedbacks}
                    disabled={isLoadingFeedbacks}
                  >
                    <RefreshCw size={12} className={isLoadingFeedbacks ? 'animate-spin' : ''} />
                    <span>Refresh</span>
                  </Button>
                </div>

                {/* Feedback Item Cards */}
                {isLoadingFeedbacks ? (
                  <div className="py-12 text-center text-muted-foreground text-xs flex flex-col items-center gap-3">
                    <RefreshCw size={24} className="animate-spin text-primary" />
                    <span>Loading feedback records…</span>
                  </div>
                ) : feedbacks.length === 0 ? (
                  <div className="py-12 border border-dashed border-border rounded-xl text-center text-muted-foreground p-6">
                    <Inbox size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium text-foreground mb-1">No feedback submissions found</p>
                    <p className="text-xs">Switch to the Submit tab to log your thoughts or bug reports.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {feedbacks.map(item => {
                      const isBusy = actionInProgress === item.id;
                      return (
                        <div
                          key={item.id}
                          className="p-4 bg-muted/20 border border-border rounded-xl shadow-xs space-y-2.5"
                        >
                          {/* Top row */}
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge
                                variant={
                                  item.feedback_type === 'BUG'
                                    ? 'critical'
                                    : item.feedback_type === 'FEATURE'
                                      ? 'success'
                                      : item.feedback_type === 'FEEDBACK'
                                        ? 'warning'
                                        : 'default'
                                }
                              >
                                {item.feedback_type}
                              </Badge>
                              {item.category && (
                                <span className="text-[10px] bg-muted border border-border text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                                  {item.category}
                                </span>
                              )}
                              <Badge variant={getStatusBadgeVariant(item.status)}>
                                {item.status}
                              </Badge>
                            </div>

                            {/* Star rating */}
                            {item.rating && (
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map(s => (
                                  <Star
                                    key={s}
                                    size={13}
                                    className={cn(
                                      s <= (item.rating || 0)
                                        ? "text-amber-500 fill-amber-500"
                                        : "text-muted-foreground/30"
                                    )}
                                  />
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Title & Description */}
                          <div>
                            {item.title && (
                              <h4 className="text-foreground font-semibold text-xs mb-1">
                                {item.title}
                              </h4>
                            )}
                            <p className="text-foreground text-xs leading-relaxed whitespace-pre-wrap">
                              {item.description}
                            </p>
                          </div>

                          {/* Metadata footer */}
                          <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-foreground font-medium">
                                @{item.user_name || 'Anonymous'}
                              </span>
                              {item.user_email && <span>({item.user_email})</span>}
                              {item.created_at && (
                                <span>• {new Date(item.created_at).toLocaleDateString()}</span>
                              )}
                            </div>

                            {isDev && (
                              <div className="flex items-center gap-1.5 ml-auto">
                                {item.status !== 'REVIEWED' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleUpdateStatus(item.id, 'REVIEWED')}
                                    className="px-2 py-1 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-md text-[10px] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
                                    title="Mark as reviewed"
                                  >
                                    <Check size={11} /> Review
                                  </button>
                                )}

                                {item.status !== 'RESOLVED' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleUpdateStatus(item.id, 'RESOLVED')}
                                    className="px-2 py-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 rounded-md text-[10px] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
                                    title="Mark as resolved"
                                  >
                                    <CheckCircle2 size={11} /> Resolve
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setFeedbackToDelete(item.id)}
                                  className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors cursor-pointer"
                                  title="Delete feedback"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {feedbackToDelete && (
        <ConfirmModal
          title="Delete feedback entry"
          message="Are you sure you want to permanently delete this feedback entry? This record will be purged from the database."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => {
            if (feedbackToDelete) {
              executeDelete(feedbackToDelete);
              setFeedbackToDelete(null);
            }
          }}
          onCancel={() => setFeedbackToDelete(null)}
        />
      )}
    </>
  );
};
