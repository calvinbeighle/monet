// Zone quick-nav panel tests per Spec 08

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ZoneQuickNav } from "./zone-quick-nav";

describe("ZoneQuickNav", () => {
  it("renders the quick-nav panel", () => {
    render(<ZoneQuickNav />);
    expect(screen.getByTestId("zone-quick-nav")).toBeInTheDocument();
  });

  it("shows all 6 zone labels with keyboard shortcuts", () => {
    render(<ZoneQuickNav />);

    expect(screen.getByTestId("zone-nav-active-front")).toBeInTheDocument();
    expect(screen.getByTestId("zone-nav-opportunities")).toBeInTheDocument();
    expect(screen.getByTestId("zone-nav-at-risk")).toBeInTheDocument();
    expect(screen.getByTestId("zone-nav-lost")).toBeInTheDocument();
    expect(screen.getByTestId("zone-nav-noise")).toBeInTheDocument();
    expect(screen.getByTestId("zone-nav-base-handled")).toBeInTheDocument();
  });

  it("displays zone names from ZONE_DEFINITIONS", () => {
    render(<ZoneQuickNav />);

    expect(screen.getByText("Active Front")).toBeInTheDocument();
    expect(screen.getByText("Opportunities")).toBeInTheDocument();
    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("Lost")).toBeInTheDocument();
    expect(screen.getByText("Noise")).toBeInTheDocument();
    expect(screen.getByText("Base / Handled")).toBeInTheDocument();
  });

  it("displays keyboard shortcut keys 1-6", () => {
    render(<ZoneQuickNav />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("calls onNavigate with correct zoneId when clicked", () => {
    const onNavigate = vi.fn();
    render(<ZoneQuickNav onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId("zone-nav-at-risk"));
    expect(onNavigate).toHaveBeenCalledWith("at-risk");

    fireEvent.click(screen.getByTestId("zone-nav-opportunities"));
    expect(onNavigate).toHaveBeenCalledWith("opportunities");
  });

  it("renders without onNavigate callback (optional)", () => {
    render(<ZoneQuickNav />);
    // Should not throw when clicking without callback
    fireEvent.click(screen.getByTestId("zone-nav-active-front"));
  });
});
