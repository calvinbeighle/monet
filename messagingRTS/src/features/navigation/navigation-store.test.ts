// Navigation store tests per Spec 08
// Tests camera state, search lifecycle, selection, and navigation history

import { describe, it, expect, beforeEach } from "vitest";
import { useNavigationStore } from "./navigation-store";

describe("NavigationStore", () => {
  beforeEach(() => {
    // Reset store between tests
    useNavigationStore.setState({
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
    });
  });

  describe("Camera state", () => {
    it("starts with default camera at tactical zoom", () => {
      const state = useNavigationStore.getState();
      expect(state.camera.x).toBe(0);
      expect(state.camera.y).toBe(0);
      expect(state.camera.zoom).toBe(0.5);
      expect(state.camera.level).toBe("tactical");
    });

    it("syncs camera state from renderer", () => {
      useNavigationStore.getState().syncCamera({ x: 100, y: 200, zoom: 1.0, level: "operational" });
      const cam = useNavigationStore.getState().camera;
      expect(cam.x).toBe(100);
      expect(cam.y).toBe(200);
      expect(cam.zoom).toBe(1.0);
      expect(cam.level).toBe("operational");
    });
  });

  describe("Navigation history", () => {
    it("starts with no history", () => {
      expect(useNavigationStore.getState().previousCamera).toBeNull();
    });

    it("saves current camera state as history", () => {
      useNavigationStore.getState().syncCamera({ x: 100, y: 200, zoom: 0.8, level: "operational" });
      useNavigationStore.getState().saveCameraHistory();
      const prev = useNavigationStore.getState().previousCamera;
      expect(prev).toEqual({ x: 100, y: 200, zoom: 0.8, level: "operational" });
    });

    it("restores previous camera and clears history (shallow)", () => {
      useNavigationStore.getState().syncCamera({ x: 100, y: 200, zoom: 0.8, level: "operational" });
      useNavigationStore.getState().saveCameraHistory();

      const restored = useNavigationStore.getState().restorePreviousCamera();
      expect(restored).toEqual({ x: 100, y: 200, zoom: 0.8, level: "operational" });
      expect(useNavigationStore.getState().previousCamera).toBeNull();
    });

    it("returns null when no history", () => {
      const restored = useNavigationStore.getState().restorePreviousCamera();
      expect(restored).toBeNull();
    });

    it("second back press does nothing (shallow history)", () => {
      useNavigationStore.getState().syncCamera({ x: 100, y: 200, zoom: 0.8, level: "operational" });
      useNavigationStore.getState().saveCameraHistory();
      useNavigationStore.getState().restorePreviousCamera();
      const second = useNavigationStore.getState().restorePreviousCamera();
      expect(second).toBeNull();
    });
  });

  describe("Detail panel", () => {
    it("starts closed", () => {
      expect(useNavigationStore.getState().detailPanelOpen).toBe(false);
    });

    it("opens and closes", () => {
      useNavigationStore.getState().openDetailPanel();
      expect(useNavigationStore.getState().detailPanelOpen).toBe(true);
      useNavigationStore.getState().closeDetailPanel();
      expect(useNavigationStore.getState().detailPanelOpen).toBe(false);
    });
  });

  describe("Search", () => {
    it("starts inactive", () => {
      const state = useNavigationStore.getState();
      expect(state.searchActive).toBe(false);
      expect(state.searchState).toBe("inactive");
      expect(state.searchQuery).toBe("");
      expect(state.searchResults).toEqual([]);
      expect(state.searchFocusIndex).toBe(-1);
    });

    it("opens search with clean state", () => {
      useNavigationStore.getState().openSearch();
      const state = useNavigationStore.getState();
      expect(state.searchActive).toBe(true);
      expect(state.searchQuery).toBe("");
      expect(state.searchResults).toEqual([]);
    });

    it("sets search query", () => {
      useNavigationStore.getState().openSearch();
      useNavigationStore.getState().setSearchQuery("test");
      expect(useNavigationStore.getState().searchQuery).toBe("test");
    });

    it("sets search results with focus on first result", () => {
      useNavigationStore.getState().openSearch();
      useNavigationStore.getState().setSearchResults(["t1", "t2", "t3"]);
      const state = useNavigationStore.getState();
      expect(state.searchResults).toEqual(["t1", "t2", "t3"]);
      expect(state.searchFocusIndex).toBe(0);
      expect(state.searchState).toBe("active-with-results");
    });

    it("sets no-results state when empty", () => {
      useNavigationStore.getState().openSearch();
      useNavigationStore.getState().setSearchResults([]);
      const state = useNavigationStore.getState();
      expect(state.searchFocusIndex).toBe(-1);
      expect(state.searchState).toBe("active-no-results");
    });

    it("cycles focus forward through results", () => {
      useNavigationStore.getState().openSearch();
      useNavigationStore.getState().setSearchResults(["t1", "t2", "t3"]);

      useNavigationStore.getState().focusNextResult();
      expect(useNavigationStore.getState().searchFocusIndex).toBe(1);

      useNavigationStore.getState().focusNextResult();
      expect(useNavigationStore.getState().searchFocusIndex).toBe(2);

      // Wraps around
      useNavigationStore.getState().focusNextResult();
      expect(useNavigationStore.getState().searchFocusIndex).toBe(0);
    });

    it("cycles focus backward through results", () => {
      useNavigationStore.getState().openSearch();
      useNavigationStore.getState().setSearchResults(["t1", "t2", "t3"]);

      // From first result, wraps to last
      useNavigationStore.getState().focusPreviousResult();
      expect(useNavigationStore.getState().searchFocusIndex).toBe(2);

      useNavigationStore.getState().focusPreviousResult();
      expect(useNavigationStore.getState().searchFocusIndex).toBe(1);
    });

    it("closes search and resets all state", () => {
      useNavigationStore.getState().openSearch();
      useNavigationStore.getState().setSearchQuery("hello");
      useNavigationStore.getState().setSearchResults(["t1"]);
      useNavigationStore.getState().closeSearch();

      const state = useNavigationStore.getState();
      expect(state.searchActive).toBe(false);
      expect(state.searchQuery).toBe("");
      expect(state.searchResults).toEqual([]);
      expect(state.searchFocusIndex).toBe(-1);
      expect(state.searchState).toBe("inactive");
    });

    it("clears search query and results without closing", () => {
      useNavigationStore.getState().openSearch();
      useNavigationStore.getState().setSearchQuery("hello");
      useNavigationStore.getState().setSearchResults(["t1"]);
      useNavigationStore.getState().clearSearch();

      const state = useNavigationStore.getState();
      expect(state.searchQuery).toBe("");
      expect(state.searchResults).toEqual([]);
      expect(state.searchState).toBe("inactive");
    });
  });

  describe("Edge scrolling", () => {
    it("starts with no edge scroll direction", () => {
      expect(useNavigationStore.getState().edgeScrollDirection).toBeNull();
    });

    it("sets and clears edge scroll direction", () => {
      useNavigationStore.getState().setEdgeScrollDirection({ x: 5, y: 0 });
      expect(useNavigationStore.getState().edgeScrollDirection).toEqual({ x: 5, y: 0 });

      useNavigationStore.getState().setEdgeScrollDirection(null);
      expect(useNavigationStore.getState().edgeScrollDirection).toBeNull();
    });
  });

  describe("Composer state per Spec 08 Section 14", () => {
    it("starts with composer inactive", () => {
      expect(useNavigationStore.getState().composerActive).toBe(false);
    });

    it("sets composer active", () => {
      useNavigationStore.getState().setComposerActive(true);
      expect(useNavigationStore.getState().composerActive).toBe(true);
    });

    it("clears composer active", () => {
      useNavigationStore.getState().setComposerActive(true);
      useNavigationStore.getState().setComposerActive(false);
      expect(useNavigationStore.getState().composerActive).toBe(false);
    });

    it("closeDetailPanel also clears composer active", () => {
      useNavigationStore.getState().openDetailPanel();
      useNavigationStore.getState().setComposerActive(true);
      useNavigationStore.getState().closeDetailPanel();
      expect(useNavigationStore.getState().composerActive).toBe(false);
      expect(useNavigationStore.getState().detailPanelOpen).toBe(false);
    });
  });
});
