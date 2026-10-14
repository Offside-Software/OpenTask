import { createClient } from '@supabase/supabase-js';
import type { TaskAttachment } from '../models';

let client: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
    if (!client) {
        const url = import.meta.env.VITE_SUPABASE_URL;
        const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

        if (!url || !key) {
            throw new Error(
                "Supabase is not configured. Please ensure SUPABASE_URL and SUPABASE_KEY are set in your root .env file."
            );
        }
        client = createClient(url, key);
    }
    return client;
}

export const supabase = {
    get storage() {
        return getSupabase().storage;
    }
};

export const OPENTASK_STORAGE_BUCKET = 'opentask';
export const ATTACHMENTS_FOLDER = 'tasks-attachments';
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit strictly enforced

export function formatFileSize(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function isImageFile(fileNameOrType: string): boolean {
    if (!fileNameOrType) return false;
    const lower = fileNameOrType.toLowerCase();
    if (lower.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(lower);
}

export function sanitizeFileName(fileName: string): string {
    // Preserve extension, replace special chars with underscores
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1) {
        return fileName.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    const name = fileName.slice(0, lastDotIndex).replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = fileName.slice(lastDotIndex).replace(/[^a-zA-Z0-9.]/g, '');
    return `${name || 'file'}${ext}`;
}

export async function uploadTaskAttachment(
    taskId: string | number,
    file: File
): Promise<TaskAttachment> {
    // 1. Strict file size validation check before accepting upload
    if (file.size > MAX_FILE_SIZE_BYTES) {
        const currentMb = (file.size / (1024 * 1024)).toFixed(1);
        throw new Error(`File "${file.name}" (${currentMb} MB) exceeds maximum allowed size of 10 MB.`);
    }

    const cleanName = sanitizeFileName(file.name);
    const timestamp = Date.now();
    const filePath = `${ATTACHMENTS_FOLDER}/${String(taskId)}/${timestamp}_${cleanName}`;

    // 2. Upload file to Supabase storage bucket 'opentask'
    const { data, error } = await supabase.storage
        .from(OPENTASK_STORAGE_BUCKET)
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || 'application/octet-stream',
        });

    if (error) {
        throw new Error(`Upload failed: ${error.message}`);
    }

    // 3. Obtain public URL for direct preview & download
    const { data: publicUrlData } = supabase.storage
        .from(OPENTASK_STORAGE_BUCKET)
        .getPublicUrl(data.path);

    const attachment: TaskAttachment = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${timestamp}_${Math.random().toString(36).substring(2, 9)}`,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        path: data.path,
        url: publicUrlData.publicUrl,
        created_at: new Date().toISOString(),
    };

    return attachment;
}

export async function deleteTaskAttachment(path: string): Promise<void> {
    if (!path) return;
    const { error } = await supabase.storage
        .from(OPENTASK_STORAGE_BUCKET)
        .remove([path]);

    if (error) {
        console.warn('Failed to delete file from Supabase storage:', error.message);
    }
}

/**
 * Deletes all attachments for a given task from Supabase Storage bucket 'opentask'.
 * Gathers paths from the known attachments array (if provided) and lists the task's
 * folder ('tasks-attachments/{taskId}/') to ensure zero orphaned files remain in storage.
 */
export async function deleteAllTaskAttachments(
    taskId: string | number,
    attachments?: TaskAttachment[]
): Promise<void> {
    if (!taskId) return;
    const folder = `${ATTACHMENTS_FOLDER}/${String(taskId)}`;
    const pathsToDelete = new Set<string>();

    // 1. Gather all known paths from provided attachments
    if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
            if (att.path) {
                pathsToDelete.add(att.path);
            }
        }
    }

    // 2. Query Supabase Storage folder to catch all uploaded files in the task directory
    try {
        const { data: files, error: listError } = await supabase.storage
            .from(OPENTASK_STORAGE_BUCKET)
            .list(folder, { limit: 100 });

        if (!listError && files && Array.isArray(files)) {
            for (const file of files) {
                if (file.name && file.name !== '.emptyFolderPlaceholder') {
                    pathsToDelete.add(`${folder}/${file.name}`);
                }
            }
        }
    } catch (err) {
        console.warn(`Failed to list files in ${folder} during task deletion:`, err);
    }

    // 3. Remove all files in batch from Supabase Storage
    if (pathsToDelete.size > 0) {
        const pathsArray = Array.from(pathsToDelete);
        const { error: removeError } = await supabase.storage
            .from(OPENTASK_STORAGE_BUCKET)
            .remove(pathsArray);

        if (removeError) {
            console.warn(`Failed to remove attachments for task ${taskId}:`, removeError.message);
        }
    }
}

