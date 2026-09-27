import type { MediaResponse } from '@sp/contracts';
import * as Crypto from 'expo-crypto';
import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { UploadCheckpoint } from '@/lib/upload';

const storage = createMMKV({ id: 'sp-drafts' });

export interface DraftVideo {
  uri: string;
  fileName: string;
  mimeType: string;
  size: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

export interface DestinationDraft {
  selected: boolean;
  titleOverride?: string;
  captionOverride?: string;
  options: Record<string, unknown>;
}

export interface UploadState {
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error';
  progress: number;
  error?: string | null;
  checkpoint?: UploadCheckpoint | null;
  media?: MediaResponse | null;
}

interface DraftStore {
  video: DraftVideo | null;
  title: string;
  caption: string;
  destinations: Record<string, DestinationDraft>;
  /** Generated when the draft starts so retries and restarts never create duplicate posts (§16.1). */
  idempotencyKey: string;
  upload: UploadState;
  setVideo(video: DraftVideo): void;
  startFromShare(video: DraftVideo): void;
  setTitle(title: string): void;
  setCaption(caption: string): void;
  setDestination(socialAccountId: string, patch: Partial<DestinationDraft>): void;
  setUpload(patch: Partial<UploadState>): void;
  reset(): void;
}

const initialUpload: UploadState = { status: 'idle', progress: 0, error: null, checkpoint: null, media: null };

export const useDraft = create<DraftStore>()(
  persist(
    (set) => ({
      video: null,
      title: '',
      caption: '',
      destinations: {},
      idempotencyKey: Crypto.randomUUID(),
      upload: initialUpload,

      setVideo: (video) => set({ video, upload: initialUpload, idempotencyKey: Crypto.randomUUID() }),
      startFromShare: (video) => set({ video, upload: initialUpload, idempotencyKey: Crypto.randomUUID() }),
      setTitle: (title) => set({ title }),
      setCaption: (caption) => set({ caption }),
      setDestination: (socialAccountId, patch) =>
        set((state) => {
          const current = state.destinations[socialAccountId] ?? { selected: false, options: {} };
          return { destinations: { ...state.destinations, [socialAccountId]: { ...current, ...patch, options: { ...current.options, ...(patch.options ?? {}) } } } };
        }),
      setUpload: (patch) => set((state) => ({ upload: { ...state.upload, ...patch } })),
      reset: () => set({ video: null, title: '', caption: '', destinations: {}, idempotencyKey: Crypto.randomUUID(), upload: initialUpload }),
    }),
    {
      name: 'post-draft',
      storage: createJSONStorage(() => ({
        getItem: (key) => storage.getString(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => {
          storage.remove(key);
        },
      })),
      // An in-flight upload can't continue after a restart; keep its checkpoint so it resumes instead.
      partialize: (state) => ({
        video: state.video,
        title: state.title,
        caption: state.caption,
        destinations: state.destinations,
        idempotencyKey: state.idempotencyKey,
        upload: { ...state.upload, status: state.upload.status === 'uploading' ? 'idle' : state.upload.status },
      }),
    },
  ),
);
