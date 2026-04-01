// Navigation store per Spec 08
// Manages camera state (synced from renderer), search, selection context, and nav history
// Camera is authoritative in the MapRenderer; this store mirrors it for React consumption

import { create } from "zustand";

export type ZoomLevel = "strategic" | "tactical" | "operational" | "detail";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  level: ZoomLevel;
}

export type SearchState = "inactive" | "active-with-results" | "active-no-results";

interface NavigationStore {
  // Camera state (mirrored from renderer for React)
  camera: CameraState;

  // Selection per Spec 08 - detail panel open state
  detailPanelOpen: boolean;

  // Composer state per Spec 08 Section 14 - three-step Escape sequence
  composerActive: boolean;

  // Search per Spec 08
  searchActive: boolean;
  searchQuery: string;
  searchResults: string[]; // matching thread IDs in map-coordinate order
  searchFocusIndex: number;
  searchState: SearchState;

  // Navigation history per Spec 08 - shallow (one prior state)
  previousCamera: CameraState | null;

  // Edge scrolling
  edgeScrollDirection: { x: number; y: number } | null;

  // Actions
  syncCamera: (state: CameraState) => void;
  saveCameraHistory: () => void;
  restorePreviousCamera: () => CameraState | null;

  openDetailPanel: () => void;
  closeDetailPanel: () => void;
  setComposerActive: (active: boolean) => void;

  openSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: string[]) => void;
  focusNextResult: () => void;
  focusPreviousResult: () => void;
  clearSearch: () => void;

  setEdgeScrollDirection: (dir: { x: number; y: number } | null) => void;
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  camera: { x: 0, y: 0, zoom: 0.5, level: "tactical" },

  detailPanelOpen: false,
  composerActive: false,

  searchActive: false,
  searchQuery: "",
  searchResults: [],
  searchFocusIndex: -1,
  searchState: "inactive",

  previousCamera: null,

  edgeScrollDirection: null,

  syncCamera: (camera) => set({ camera }),

  saveCameraHistory: () => {
    const current = get().camera;
    set({ previousCamera: { ...current } });
  },

  restorePreviousCamera: () => {
    const prev = get().previousCamera;
    if (prev) {
      set({ previousCamera: null });
    }
    return prev;
  },

  openDetailPanel: () => set({ detailPanelOpen: true }),
  closeDetailPanel: () => set({ detailPanelOpen: false, composerActive: false }),
  setComposerActive: (active) => set({ composerActive: active }),

  openSearch: () =>
    set({ searchActive: true, searchQuery: "", searchResults: [], searchFocusIndex: -1 }),
  closeSearch: () =>
    set({
      searchActive: false,
      searchQuery: "",
      searchResults: [],
      searchFocusIndex: -1,
      searchState: "inactive",
    }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSearchResults: (results) =>
    set({
      searchResults: results,
      searchFocusIndex: results.length > 0 ? 0 : -1,
      searchState: results.length > 0 ? "active-with-results" : "active-no-results",
    }),

  focusNextResult: () =>
    set((state) => {
      if (state.searchResults.length === 0) return state;
      const next = (state.searchFocusIndex + 1) % state.searchResults.length;
      return { searchFocusIndex: next };
    }),

  focusPreviousResult: () =>
    set((state) => {
      if (state.searchResults.length === 0) return state;
      const prev =
        state.searchFocusIndex <= 0 ? state.searchResults.length - 1 : state.searchFocusIndex - 1;
      return { searchFocusIndex: prev };
    }),

  clearSearch: () =>
    set({
      searchQuery: "",
      searchResults: [],
      searchFocusIndex: -1,
      searchState: "inactive",
    }),

  setEdgeScrollDirection: (dir) => set({ edgeScrollDirection: dir }),
}));
