// FabActivity — mobile-only floating action button bottom-right.
//
// Tap opens the Live Activity sheet (not yet wired — onClick stub for now).
// Carries a count badge showing recent events/min. Hidden at >=1024px where
// the activity rail is rendered inline on the page.

import { Icon } from "./icon-sprite.tsx";
import "./FabActivity.css";

export interface FabActivityProps {
  count?: number;
  onOpen?: () => void;
}

export function FabActivity({ count = 218, onOpen }: FabActivityProps) {
  return (
    <button
      type="button"
      className="y2-fab-activity"
      aria-label={`Open live activity (${count} events)`}
      onClick={onOpen}
    >
      <Icon name="activity" size={22} />
      <span className="y2-fab-badge" aria-hidden="true">
        {count}
      </span>
    </button>
  );
}
