import { create } from 'zustand';
import type { ChatMsg } from '../lib/assistant';

/** Shared open/seed state so other UI (e.g. the suggestion banner) can open the
 *  chat and pre-load it with a starting message to continue the conversation. */
interface AssistantUI {
  open: boolean;
  /** Messages to pre-load when the panel opens (consumed once). */
  seed: ChatMsg[] | null;
  openWith: (seed?: ChatMsg[]) => void;
  close: () => void;
  consumeSeed: () => void;
}

export const useAssistant = create<AssistantUI>()((set) => ({
  open: false,
  seed: null,
  openWith: (seed) => set({ open: true, seed: seed ?? null }),
  close: () => set({ open: false }),
  consumeSeed: () => set({ seed: null }),
}));
