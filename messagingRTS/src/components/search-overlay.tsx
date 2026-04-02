// Search overlay per Spec 08 and Spec 12
// Keyboard-activated search bar overlaid at top of map viewport.
// Matches by keyword (subject/snippet), sender, or label.
// Highlights results on map, pans to first match, cycles through results.

import { useRef, useEffect, useCallback } from "react";
import { useNavigationStore } from "../features/navigation/navigation-store";

interface SearchOverlayProps {
  onSearch: (query: string) => void;
  onCycleNext: () => void;
  onCyclePrevious: () => void;
  onClose: () => void;
}

export function SearchOverlay({
  onSearch,
  onCycleNext,
  onCyclePrevious,
  onClose,
}: SearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchActive = useNavigationStore((s) => s.searchActive);
  const searchQuery = useNavigationStore((s) => s.searchQuery);
  const searchResults = useNavigationStore((s) => s.searchResults);
  const searchFocusIndex = useNavigationStore((s) => s.searchFocusIndex);
  const searchState = useNavigationStore((s) => s.searchState);

  // Focus input when search opens per Spec 12
  useEffect(() => {
    if (searchActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchActive]);

  // Per Spec 12 Section 6: close search when user clicks outside the overlay
  useEffect(() => {
    if (!searchActive) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use capture to intercept before the map handler
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => document.removeEventListener("mousedown", handleClickOutside, true);
  }, [searchActive, onClose]);

  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Enter") {
        // Per Spec 12 Section 6: submitting a search closes the overlay.
        // Shift+Enter cycles to previous result without closing.
        if (e.shiftKey) {
          onCyclePrevious();
        } else {
          // Cycle to next result, then close if there are results or a query
          if (searchResults.length > 0) {
            onCycleNext();
          }
          onClose();
        }
      } else if (e.key === "Tab") {
        // Trap focus within search overlay per Spec 12 Section 6
        e.preventDefault();
        const focusable = overlayRef.current?.querySelectorAll(
          'input, button, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable && focusable.length > 0) {
          const elements = Array.from(focusable) as HTMLElement[];
          const currentIdx = elements.indexOf(document.activeElement as HTMLElement);
          const direction = e.shiftKey ? -1 : 1;
          const nextIdx = (currentIdx + direction + elements.length) % elements.length;
          elements[nextIdx].focus();
        }
      }
    },
    [onClose, onCycleNext, onCyclePrevious, searchResults.length],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSearch(e.target.value);
    },
    [onSearch],
  );

  if (!searchActive) return null;

  const resultText =
    searchState === "active-no-results"
      ? "No results"
      : searchResults.length > 0
        ? `${searchFocusIndex + 1} of ${searchResults.length}`
        : "";

  return (
    <div
      ref={overlayRef}
      className="absolute top-0 left-0 right-0 flex items-center gap-2 bg-black/80 px-4 py-2 backdrop-blur-sm border-b border-white/10"
      style={{ zIndex: 25 }}
      data-testid="search-overlay"
      role="search"
      aria-label="Search threads"
      onKeyDown={handleKeyDown}
    >
      <svg
        className="w-4 h-4 text-white/50 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={handleChange}
        placeholder="Search threads by keyword, sender, or label..."
        className="flex-1 bg-transparent text-white text-sm outline-none placeholder-white/30"
        data-testid="search-input"
      />
      {resultText && (
        <span
          className={`text-xs shrink-0 ${searchState === "active-no-results" ? "text-red-400" : "text-white/50"}`}
          data-testid="search-result-count"
        >
          {resultText}
        </span>
      )}
      <button
        onClick={onClose}
        className="text-white/50 hover:text-white/80 text-xs shrink-0"
        data-testid="search-close"
      >
        ESC
      </button>
    </div>
  );
}
