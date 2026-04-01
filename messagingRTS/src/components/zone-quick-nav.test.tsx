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

  describe("focusedZone prop (Spec 08 Section 16)", () => {
    it("marks the focused zone button as aria-selected=true", () => {
      render(<ZoneQuickNav focusedZone="opportunities" />);
      const btn = screen.getByTestId("zone-nav-opportunities");
      expect(btn).toHaveAttribute("aria-selected", "true");
    });

    it("marks non-focused zone buttons as aria-selected=false", () => {
      render(<ZoneQuickNav focusedZone="opportunities" />);
      expect(screen.getByTestId("zone-nav-active-front")).toHaveAttribute("aria-selected", "false");
      expect(screen.getByTestId("zone-nav-at-risk")).toHaveAttribute("aria-selected", "false");
      expect(screen.getByTestId("zone-nav-lost")).toHaveAttribute("aria-selected", "false");
    });

    it("highlights only the focused zone with tabIndex 0", () => {
      render(<ZoneQuickNav focusedZone="at-risk" />);
      expect(screen.getByTestId("zone-nav-at-risk")).toHaveAttribute("tabIndex", "0");
      expect(screen.getByTestId("zone-nav-active-front")).toHaveAttribute("tabIndex", "-1");
    });

    it("no zone is highlighted when focusedZone is null", () => {
      render(<ZoneQuickNav focusedZone={null} />);
      const allButtons = [
        screen.getByTestId("zone-nav-active-front"),
        screen.getByTestId("zone-nav-opportunities"),
        screen.getByTestId("zone-nav-at-risk"),
        screen.getByTestId("zone-nav-lost"),
        screen.getByTestId("zone-nav-noise"),
        screen.getByTestId("zone-nav-base-handled"),
      ];
      for (const btn of allButtons) {
        expect(btn).toHaveAttribute("aria-selected", "false");
      }
    });

    it("no zone is highlighted when focusedZone is undefined", () => {
      render(<ZoneQuickNav />);
      const btn = screen.getByTestId("zone-nav-active-front");
      expect(btn).toHaveAttribute("aria-selected", "false");
    });
  });
});
