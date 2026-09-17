export const DEFAULT_TASK_TYPES: string[] = ['CODE', 'REQUIREMENT', 'DESIGN', 'NON-CODE', 'OTHER'];

const STORAGE_KEY = 'opentask_custom_task_types';

export const getCustomTaskTypes = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveCustomTaskType = (newType: string): string[] => {
  const trimmed = newType.trim().toUpperCase();
  if (!trimmed) return getCustomTaskTypes();

  const existing = getCustomTaskTypes();
  if (!DEFAULT_TASK_TYPES.includes(trimmed) && !existing.includes(trimmed)) {
    const updated = [...existing, trimmed];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to persist custom task type', e);
    }
    return updated;
  }
  return existing;
};

export const getAllTaskTypes = (extraTypes: (string | undefined)[] = []): string[] => {
  const custom = getCustomTaskTypes();
  const set = new Set<string>([...DEFAULT_TASK_TYPES, ...custom]);
  extraTypes.forEach((t) => {
    if (t && typeof t === 'string' && t.trim()) {
      set.add(t.trim().toUpperCase());
    }
  });
  return Array.from(set);
};

export const getTaskTypeVariant = (
  type: string
): 'primary' | 'critical' | 'warning' | 'success' | 'default' | 'outline' => {
  const upper = type ? String(type).trim().toUpperCase() : '';
  if (upper === 'CODE') return 'primary';
  if (upper === 'BUG' || upper === 'CRITICAL' || upper === 'HOTFIX') return 'critical';
  if (upper === 'DESIGN' || upper === 'UI' || upper === 'UX') return 'warning';
  if (upper === 'REQUIREMENT' || upper === 'SPEC' || upper === 'QA') return 'success';
  return 'default';
};
