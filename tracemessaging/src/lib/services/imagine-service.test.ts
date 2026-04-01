import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWorkstreamStore } from "../stores/workstream-store";
import { createWorkstream } from "../types/workstream";
import {
  needsImageRefresh,
  requestImage,
  stopImagineService,
} from "./imagine-service";

// Mock the api-client module
vi.mock("./api-client", () => ({
  apiPost: vi.fn(),
}));

import { apiPost } from "./api-client";

const mockApiPost = vi.mocked(apiPost);

describe("imagine-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useWorkstreamStore.getState().setWorkstreams([]);
  });

  afterEach(() => {
    stopImagineService();
    vi.useRealTimers();
  });

  describe("needsImageRefresh", () => {
    it("returns true when workstream has no image", () => {
      const ws = createWorkstream("ws-1", "Test Workstream");
      expect(needsImageRefresh(ws)).toBe(true);
    });

    it("returns false when image is fresh", () => {
      const ws = createWorkstream("ws-1", "Test Workstream", {
        imageUrl: "https://example.com/img.png",
        imageGeneratedAt: Date.now(),
      });
      expect(needsImageRefresh(ws)).toBe(false);
    });

    it("returns true when image is older than 30 minutes", () => {
      const ws = createWorkstream("ws-1", "Test Workstream", {
        imageUrl: "https://example.com/img.png",
        imageGeneratedAt: Date.now() - 31 * 60 * 1000,
      });
      expect(needsImageRefresh(ws)).toBe(true);
    });
  });

  describe("requestImage", () => {
    it("calls API with prompt when immediate=true", async () => {
      const ws = createWorkstream("ws-1", "Client Proposal", {
        sourceBreakdown: { gmail: 3, git: 2 },
      });
      useWorkstreamStore.getState().setWorkstream(ws);

      mockApiPost.mockResolvedValueOnce({
        workstreamId: "ws-1",
        url: "https://xai.example.com/generated.png",
        b64_json: "",
        generatedAt: Date.now(),
      });

      requestImage("ws-1", true);

      // Let the async call resolve
      await vi.runAllTimersAsync();

      expect(mockApiPost).toHaveBeenCalledWith(
        "/imagine/generate",
        expect.objectContaining({
          workstreamId: "ws-1",
          prompt: expect.stringContaining("Theme: Client Proposal"),
        }),
      );

      // Check that workstream was updated with the image URL
      const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
      expect(updated?.imageUrl).toBe("https://xai.example.com/generated.png");
    });

    it("stores base64 data URL when url is empty", async () => {
      const ws = createWorkstream("ws-1", "Research");
      useWorkstreamStore.getState().setWorkstream(ws);

      mockApiPost.mockResolvedValueOnce({
        workstreamId: "ws-1",
        url: "",
        b64_json: "iVBORw0KGgoAAAANS",
        generatedAt: Date.now(),
      });

      requestImage("ws-1", true);
      await vi.runAllTimersAsync();

      const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
      expect(updated?.imageUrl).toBe("data:image/png;base64,iVBORw0KGgoAAAANS");
    });

    it("does not throw on API error", async () => {
      const ws = createWorkstream("ws-1", "Test");
      useWorkstreamStore.getState().setWorkstream(ws);

      mockApiPost.mockRejectedValueOnce(new Error("API error 503"));

      // Should not throw
      requestImage("ws-1", true);
      await vi.runAllTimersAsync();

      // Workstream should remain unchanged
      const updated = useWorkstreamStore.getState().getWorkstream("ws-1");
      expect(updated?.imageUrl).toBeNull();
    });

    it("debounces multiple rapid calls", async () => {
      const ws = createWorkstream("ws-1", "Test");
      useWorkstreamStore.getState().setWorkstream(ws);

      mockApiPost.mockResolvedValue({
        workstreamId: "ws-1",
        url: "https://xai.example.com/img.png",
        b64_json: "",
        generatedAt: Date.now(),
      });

      // Rapid calls without immediate flag
      requestImage("ws-1");
      requestImage("ws-1");
      requestImage("ws-1");

      // Advance past debounce window (10 seconds)
      await vi.advanceTimersByTimeAsync(11_000);

      // Should only have called API once
      expect(mockApiPost).toHaveBeenCalledTimes(1);
    });

    it("includes source-specific prompt elements", async () => {
      const ws = createWorkstream("ws-1", "Deal Pipeline", {
        sourceBreakdown: { hubspot: 5, gmail: 3 },
      });
      useWorkstreamStore.getState().setWorkstream(ws);

      mockApiPost.mockResolvedValueOnce({
        workstreamId: "ws-1",
        url: "https://example.com/img.png",
        b64_json: "",
        generatedAt: Date.now(),
      });

      requestImage("ws-1", true);
      await vi.runAllTimersAsync();

      const call = mockApiPost.mock.calls[0];
      const prompt = (call[1] as { prompt: string }).prompt;
      expect(prompt).toContain("Business topology");
      expect(prompt).toContain("Communication streams");
    });
  });
});
