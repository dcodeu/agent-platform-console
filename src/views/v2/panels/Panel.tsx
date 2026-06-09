// Panel — convenience wrapper that looks up a logical key in the panel
// registry and renders the corresponding IframePanel.
//
// Use this in views; only drop down to <IframePanel uid=... panelId=... /> for
// ad-hoc embeds that aren't in the registry.

import { IframePanel } from "./IframePanel.tsx";
import { PANELS, type PanelKey } from "./panel-registry.ts";

export interface PanelProps {
  name: PanelKey;
  /** Override the registry's defaultTitle. */
  title?: string;
  /** Override the variant's default pixel height. */
  height?: number;
  from?: string;
  to?: string;
}

export function Panel({ name, title, height, from, to }: PanelProps) {
  const def = PANELS[name];
  return (
    <IframePanel
      uid={def.uid}
      panelId={def.panelId}
      variant={def.variant}
      title={title ?? def.defaultTitle}
      height={height}
      from={from}
      to={to}
    />
  );
}
