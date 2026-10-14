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

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'submit' | 'review';
}

const FEEDBACK_TYPES: { type: FeedbackType; label: string; icon: React.ElementType; color: string }[] = [
  { type: 'FEEDBACK', label: 'FEEDBACK', icon: MessageSquarePlus, color: '#FFE600' },
  { type: 'BUG', label: 'BUG REPORT', icon: Bug, color: '#FF3333' },
  { type: 'FEATURE', label: 'FEATURE IDEA', icon: Lightbulb, color: '#00FF66' },
  { type: 'GENERAL', label: 'ALPHA REVIEW', icon: Sparkles, color: '#FF9900' },
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

  // Dev / Localhost Detection (to restrict administrative delete & status changes)
  const isDev = Boolean(
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.endsWith('.localhost')))
  );

  // Form State
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

  // Review List State
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm select-none animate-in fade-in duration-100">
        <div
          className="bg-white dark:bg-[#121417] text-neutral-900 dark:text-white border-3 border-black rounded-none w-full max-w-2xl shadow-[8px_8px_0px_0px_#000000] flex flex-col overflow-hidden animate-in zoom-in-95 duration-100 font-mono max-h-[90vh]"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b-2 border-black flex justify-between items-center bg-[#F0F0EB] dark:bg-[#181B20]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-none bg-[#FFE600] text-black border-2 border-black shadow-[2px_2px_0px_0px_#000000] flex items-center justify-center shrink-0">
                <MessageSquarePlus size={20} strokeWidth={2.5} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-neutral-900 dark:text-white text-[15px] sm:text-[16px] font-mono font-black uppercase tracking-wider">
                    USER FEEDBACK & REPORT
                  </h2>
                  <span className="bg-[#FFE600] text-black text-[9px] font-black px-1.5 py-0.5 border border-black uppercase">
                    ALPHA
                  </span>
                </div>
                <p className="text-neutral-400 dark:text-neutral-200 text-[10px] sm:text-[11px] uppercase tracking-wider">
                  // SHAPE THE OPENTASK ALPHA RELEASE
                </p>
              </div>
            </div>
            <CloseButton onClick={onClose} size="md" />
          </div>

          {/* Tab Switcher */}
          <div className="grid grid-cols-2 border-b-2 border-black bg-neutral-200 dark:bg-[#0C0D0E]">
            <button
              type="button"
              onClick={() => setActiveTab('submit')}
              className={`py-3 px-4 text-[12px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer border-r border-black dark:border-neutral-800 ${activeTab === 'submit'
                ? 'bg-[#FFE600] text-black shadow-[inset_0_-2px_0_0_#000000]'
                : 'text-neutral-700 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:bg-neutral-300 dark:hover:bg-[#181B20]'
                }`}
            >
              <Send size={15} strokeWidth={2.5} />
              SUBMIT FEEDBACK
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('review')}
              className={`py-3 px-4 text-[12px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${activeTab === 'review'
                ? 'bg-[#FFE600] text-black shadow-[inset_0_-2px_0_0_#000000]'
                : 'text-neutral-700 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:bg-neutral-300 dark:hover:bg-[#181B20]'
                }`}
            >
              <Inbox size={15} strokeWidth={2.5} />
              REVIEW FEEDBACKS
              {feedbacks.length > 0 && (
                <span className="ml-1 text-[10px] bg-black text-neutral-600 dark:text-white px-1.5 py-0.2 border border-black">
                  {feedbacks.length}
                </span>
              )}
            </button>
          </div>

          {/* Content Body */}
          <div className="p-4 sm:p-6 overflow-y-auto no-scrollbar max-h-[70vh] bg-white dark:bg-[#121417]">
            {activeTab === 'submit' ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                {submitSuccess && (
                  <div className="p-3 bg-[#00FF66]/20 border-2 border-black text-emerald-950 dark:text-[#00FF66] text-[12px] font-bold flex items-center gap-2 shadow-[2px_2px_0px_0px_#000000]">
                    <CheckCircle2 size={18} strokeWidth={3} className="text-emerald-700 dark:text-[#00FF66]" />
                    THANK YOU! Feedback received and saved to database.
                  </div>
                )}

                {errorMessage && (
                  <div className="p-3 bg-[#FF3333]/20 border-2 border-black text-red-950 dark:text-[#FF3333] text-[12px] font-bold flex items-center gap-2 shadow-[2px_2px_0px_0px_#000000]">
                    <AlertCircle size={18} strokeWidth={3} className="text-red-700 dark:text-[#FF3333]" />
                    {errorMessage}
                  </div>
                )}

                {/* Type Selection */}
                <div>
                  <label className="text-neutral-900 dark:text-white text-[11px] font-black uppercase tracking-wider mb-2 block">
                    <span className="text-amber-600 dark:text-[#FFE600] mr-1.5">//</span>1. REPORT CATEGORY
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {FEEDBACK_TYPES.map(({ type, label, icon: Icon, color }) => {
                      const isSelected = feedbackType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFeedbackType(type)}
                          className={`p-2.5 rounded-none border-2 transition-all flex flex-col items-center gap-1.5 cursor-pointer text-center ${isSelected
                            ? 'border-black shadow-[3px_3px_0px_0px_#000000]'
                            : 'border-neutral-300 dark:border-neutral-800 bg-neutral-100 dark:bg-[#0E1012] text-neutral-700 dark:text-neutral-400 hover:border-black dark:hover:border-neutral-600 hover:text-black dark:hover:text-white'
                            }`}
                          style={{
                            backgroundColor: isSelected ? color : undefined,
                            color: isSelected ? '#000000' : undefined,
                          }}
                        >
                          <Icon size={18} strokeWidth={2.5} />
                          <span className="text-[10px] font-black uppercase tracking-wide">
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Rating Experience */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-neutral-900 dark:text-white text-[11px] font-black uppercase tracking-wider block">
                      <span className="text-amber-600 dark:text-[#FFE600] mr-1.5">//</span>2. ALPHA EXPERIENCE RATING
                    </label>
                    <span className="text-amber-600 dark:text-[#FFE600] text-[11px] font-bold">
                      {RATING_LABELS[hoverRating || rating]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 bg-neutral-100 dark:bg-[#0E1012] p-3 border-2 border-neutral-300 dark:border-neutral-800">
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
                          className="cursor-pointer p-1 transition-transform hover:scale-115 active:scale-95"
                        >
                          <Star
                            size={24}
                            strokeWidth={2}
                            className={
                              isFilled
                                ? 'text-amber-500 dark:text-[#FFE600] fill-amber-500 dark:fill-[#FFE600]'
                                : 'text-neutral-400 dark:text-neutral-600 hover:text-amber-400'
                            }
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Context Area / Module */}
                <div>
                  <label className="text-neutral-900 dark:text-white text-[11px] font-black uppercase tracking-wider mb-2 block">
                    <span className="text-amber-600 dark:text-[#FFE600] mr-1.5">//</span>3. SUBSYSTEM AREA
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map(cat => {
                      const isSelected = category === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCategory(cat)}
                          className={`px-3 py-1 text-[11px] font-black uppercase tracking-wider border-2 transition-all cursor-pointer ${isSelected
                            ? 'bg-[#FFE600] text-black border-black shadow-[2px_2px_0px_0px_#000000]'
                            : 'bg-neutral-100 dark:bg-[#0E1012] text-neutral-700 dark:text-neutral-400 border-neutral-300 dark:border-neutral-800 hover:border-black hover:text-black dark:hover:text-white'
                            }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Title Input */}
                <div>
                  <label className="text-neutral-900 dark:text-white text-[11px] font-black uppercase tracking-wider mb-1.5 block">
                    <span className="text-amber-600 dark:text-[#FFE600] mr-1.5">//</span>4. SUMMARY TITLE (OPTIONAL)
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Kanban drag drop glitch, or AI prompt suggestion..."
                    className="w-full bg-neutral-50 dark:bg-[#0B0E14] border-2 border-neutral-400 dark:border-neutral-800 focus:border-black dark:focus:border-[#FFE600] p-3 text-[12px] font-mono text-neutral-900 dark:text-white placeholder-neutral-500 dark:placeholder-neutral-600 outline-none shadow-[2px_2px_0px_0px_#000000] transition-colors"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-neutral-900 dark:text-white text-[11px] font-black uppercase tracking-wider mb-1.5 block">
                    <span className="text-amber-600 dark:text-[#FFE600] mr-1.5">//</span>5. DETAILED FEEDBACK / BUG REPRODUCTION
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Describe your experience, what happened, expected behavior, or ideas to improve OpenTask for the Alpha release..."
                    className="w-full bg-neutral-50 dark:bg-[#0B0E14] border-2 border-neutral-400 dark:border-neutral-800 focus:border-black dark:focus:border-[#FFE600] p-3 text-[12px] font-mono text-neutral-900 dark:text-white placeholder-neutral-500 dark:placeholder-neutral-600 outline-none resize-none shadow-[2px_2px_0px_0px_#000000] transition-colors"
                  />
                </div>

                {/* Telemetry Toggle */}
                <div className="bg-neutral-100 dark:bg-[#0B0E14] border-2 border-neutral-300 dark:border-neutral-800 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Monitor size={16} className="text-amber-600 dark:text-[#FFE600]" />
                    <span className="text-neutral-800 dark:text-neutral-300 text-[11px]">
                      Include browser & screen telemetry for bug triage
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={includeDeviceInfo}
                    onChange={e => setIncludeDeviceInfo(e.target.checked)}
                    className="w-4 h-4 accent-[#FFE600] cursor-pointer"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3 justify-end pt-3 border-t-2 border-neutral-200 dark:border-neutral-800">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onClose}
                    disabled={isSubmitting}
                  >
                    CANCEL
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSubmitting || !description.trim()}
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" /> SUBMITTING...
                      </>
                    ) : (
                      <>
                        <Send size={14} strokeWidth={2.5} /> SUBMIT FEEDBACK
                      </>
                    )}
                  </Button>
                </div>
              </form>
            ) : (
              /* Review Feedbacks Tab */
              <div className="space-y-4">
                {/* Filter Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-neutral-100 dark:bg-[#0E1012] border-2 border-neutral-300 dark:border-neutral-800">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-neutral-700 dark:text-neutral-400 font-bold uppercase">FILTER:</span>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="bg-white dark:bg-black text-neutral-900 dark:text-white border-2 border-neutral-400 dark:border-neutral-700 text-[11px] px-2 py-1 outline-none uppercase font-mono cursor-pointer"
                    >
                      <option value="ALL">ALL STATUSES</option>
                      <option value="PENDING">PENDING</option>
                      <option value="REVIEWED">REVIEWED</option>
                      <option value="RESOLVED">RESOLVED</option>
                    </select>

                    <select
                      value={typeFilter}
                      onChange={e => setTypeFilter(e.target.value)}
                      className="bg-white dark:bg-black text-neutral-900 dark:text-white border-2 border-neutral-400 dark:border-neutral-700 text-[11px] px-2 py-1 outline-none uppercase font-mono cursor-pointer"
                    >
                      <option value="ALL">ALL TYPES</option>
                      <option value="FEEDBACK">FEEDBACK</option>
                      <option value="BUG">BUG REPORTS</option>
                      <option value="FEATURE">FEATURES</option>
                      <option value="GENERAL">ALPHA REVIEWS</option>
                    </select>

                    {isDev && (
                      <span className="text-[9px] bg-[#FFE600] text-black font-black px-1.5 py-0.5 border border-black uppercase flex items-center gap-1">
                        <ShieldAlert size={10} /> DEV CONTROLS ACTIVE
                      </span>
                    )}
                  </div>

                  <button
                    onClick={loadFeedbacks}
                    disabled={isLoadingFeedbacks}
                    className="px-2.5 py-1 text-[11px] bg-neutral-200 dark:bg-[#1E2227] text-neutral-900 dark:text-white border-2 border-neutral-400 dark:border-neutral-700 hover:border-black dark:hover:border-white transition-all flex items-center gap-1.5 cursor-pointer uppercase font-bold"
                  >
                    <RefreshCw size={12} className={isLoadingFeedbacks ? 'animate-spin' : ''} />
                    REFRESH
                  </button>
                </div>

                {/* Feedback Item Cards */}
                {isLoadingFeedbacks ? (
                  <div className="py-12 text-center text-neutral-600 dark:text-neutral-400 text-[12px] flex flex-col items-center gap-3">
                    <RefreshCw size={24} className="animate-spin text-amber-600 dark:text-[#FFE600]" />
                    LOADING FEEDBACK RECORDS...
                  </div>
                ) : feedbacks.length === 0 ? (
                  <div className="py-12 border-2 border-dashed border-neutral-300 dark:border-neutral-800 text-center text-neutral-600 dark:text-neutral-400 p-6">
                    <Inbox size={32} className="mx-auto mb-2 text-neutral-400 dark:text-neutral-600" />
                    <p className="text-[13px] font-bold text-neutral-900 dark:text-white mb-1">NO FEEDBACK SUBMISSIONS FOUND</p>
                    <p className="text-[11px]">Switch to the Submit tab to log your thoughts or bug reports.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {feedbacks.map(item => {
                      const isBusy = actionInProgress === item.id;
                      return (
                        <div
                          key={item.id}
                          className="p-4 bg-neutral-50 dark:bg-[#0B0E14] border-2 border-black shadow-[3px_3px_0px_0px_#000000] space-y-3"
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
                                <span className="text-[10px] bg-neutral-200 dark:bg-neutral-900 border border-neutral-400 dark:border-neutral-700 text-neutral-800 dark:text-neutral-300 px-2 py-0.5 font-bold">
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
                                    className={
                                      s <= (item.rating || 0)
                                        ? 'text-amber-500 dark:text-[#FFE600] fill-amber-500 dark:fill-[#FFE600]'
                                        : 'text-neutral-300 dark:text-neutral-700'
                                    }
                                  />
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Title & Description */}
                          <div>
                            {item.title && (
                              <h4 className="text-neutral-900 dark:text-white font-black text-[13px] uppercase mb-1">
                                {item.title}
                              </h4>
                            )}
                            <p className="text-neutral-800 dark:text-neutral-300 text-[12px] leading-relaxed whitespace-pre-wrap">
                              {item.description}
                            </p>
                          </div>

                          {/* Submitter & Metadata footer */}
                          <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[10px] text-neutral-600 dark:text-neutral-400 flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-neutral-900 dark:text-white font-bold">
                                @{item.user_name || 'Anonymous'}
                              </span>
                              {item.user_email && <span>({item.user_email})</span>}
                              {item.created_at && (
                                <span>• {new Date(item.created_at).toLocaleString()}</span>
                              )}
                            </div>

                            {/* Action Buttons: Only visible on localhost/dev environment */}
                            {isDev && (
                              <div className="flex items-center gap-1.5 ml-auto">
                                {item.status !== 'REVIEWED' && (
                                  <button
                                    disabled={isBusy}
                                    onClick={() => handleUpdateStatus(item.id, 'REVIEWED')}
                                    className="px-2 py-1 bg-neutral-200 dark:bg-[#1E2227] text-neutral-800 dark:text-neutral-300 border border-black hover:bg-black hover:text-white dark:hover:border-white text-[10px] uppercase font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
                                    title="Mark as Reviewed (Dev / Localhost only)"
                                  >
                                    <Check size={11} strokeWidth={3} /> REVIEW
                                  </button>
                                )}

                                {item.status !== 'RESOLVED' && (
                                  <button
                                    disabled={isBusy}
                                    onClick={() => handleUpdateStatus(item.id, 'RESOLVED')}
                                    className="px-2 py-1 bg-[#00FF66] text-black border border-black hover:bg-[#33FF85] text-[10px] uppercase font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors shadow-[1px_1px_0px_0px_#000000]"
                                    title="Mark as Resolved (Dev / Localhost only)"
                                  >
                                    <CheckCircle2 size={11} strokeWidth={3} /> RESOLVE
                                  </button>
                                )}

                                <button
                                  disabled={isBusy}
                                  onClick={() => setFeedbackToDelete(item.id)}
                                  className="p-1 text-neutral-500 hover:text-[#FF3333] hover:bg-[#FF3333]/10 border border-transparent hover:border-[#FF3333] transition-colors cursor-pointer"
                                  title="Delete Feedback (Dev / Localhost only)"
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

      {/* Better Confirmation Modal for Deletion */}
      {feedbackToDelete && (
        <ConfirmModal
          title="DELETE FEEDBACK ENTRY"
          message="Are you sure you want to permanently delete this feedback entry? This record will be permanently purged from the database."
          confirmLabel="DELETE RECORD"
          cancelLabel="CANCEL"
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
