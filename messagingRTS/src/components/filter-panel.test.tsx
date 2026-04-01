import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterPanel } from "./filter-panel";
import { useFilterStore } from "../lib/stores/filter-store";

function resetFilterStore() {
  useFilterStore.setState({
    filter: {
      zones: [],
      labels: [],
      senders: [],
      urgencyMin: 0,
      urgencyMax: 1,
    },
  });
}

describe("FilterPanel", () => {
  beforeEach(resetFilterStore);

  it("renders zone filter buttons for all 6 zones", () => {
    render(<FilterPanel onClose={() => {}} />);

    expect(screen.getByTestId("zone-filter-active-front")).toBeInTheDocument();
    expect(screen.getByTestId("zone-filter-opportunities")).toBeInTheDocument();
    expect(screen.getByTestId("zone-filter-at-risk")).toBeInTheDocument();
    expect(screen.getByTestId("zone-filter-lost")).toBeInTheDocument();
    expect(screen.getByTestId("zone-filter-noise")).toBeInTheDocument();
    expect(screen.getByTestId("zone-filter-base-handled")).toBeInTheDocument();
  });

  it("does not render clear all button when no filter is active", () => {
    render(<FilterPanel onClose={() => {}} />);

    expect(screen.queryByTestId("clear-filters")).not.toBeInTheDocument();
  });

  it("clear all button appears when a zone filter is active", () => {
    useFilterStore.setState({
      filter: {
        zones: ["active-front"],
        labels: [],
        senders: [],
        urgencyMin: 0,
        urgencyMax: 1,
      },
    });

    render(<FilterPanel onClose={() => {}} />);

    expect(screen.getByTestId("clear-filters")).toBeInTheDocument();
  });

  it("clear all button appears when urgency min is raised", () => {
    useFilterStore.setState({
      filter: {
        zones: [],
        labels: [],
        senders: [],
        urgencyMin: 0.3,
        urgencyMax: 1,
      },
    });

    render(<FilterPanel onClose={() => {}} />);

    expect(screen.getByTestId("clear-filters")).toBeInTheDocument();
  });

  it("close button calls onClose callback", () => {
    const onClose = vi.fn();
    render(<FilterPanel onClose={onClose} />);

    fireEvent.click(screen.getByTestId("close-filter-panel"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking a zone filter button toggles that zone in the store", () => {
    render(<FilterPanel onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("zone-filter-opportunities"));

    const state = useFilterStore.getState();
    expect(state.filter.zones).toContain("opportunities");
  });

  it("clicking clear all resets filter state", () => {
    useFilterStore.setState({
      filter: {
        zones: ["active-front", "lost"],
        labels: [],
        senders: [],
        urgencyMin: 0,
        urgencyMax: 1,
      },
    });

    render(<FilterPanel onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("clear-filters"));

    const state = useFilterStore.getState();
    expect(state.filter.zones).toHaveLength(0);
  });

  it("renders the filter panel with the correct dialog role", () => {
    render(<FilterPanel onClose={() => {}} />);

    const panel = screen.getByTestId("filter-panel");
    expect(panel).toHaveAttribute("role", "dialog");
  });
});
