// EmptyState — consistent placeholder for empty / no-data tiles.

import type { ReactNode } from "react";
import { Icon, type IconName } from "../icon-sprite.tsx";
import "./EmptyState.css";

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="w-empty">
      {icon ? (
        <div className="w-empty-i" aria-hidden="true">
          <Icon name={icon} size={20} />
        </div>
      ) : null}
      <div className="w-empty-t">{title}</div>
      {body ? <div className="w-empty-b">{body}</div> : null}
      {action ? <div className="w-empty-a">{action}</div> : null}
    </div>
  );
}
