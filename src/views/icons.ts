// Lucide icon set — inlined SVG strings.
// All icons share stroke-width 1.75, no fill, currentColor.
// Sources are 1:1 with lucide.dev names so they can be cross-referenced.

const ICON_BASE = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;

export function icon(name: IconName, size = 20): string {
  const body = ICONS[name] ?? "";
  return `<svg width="${size}" height="${size}" ${ICON_BASE}>${body}</svg>`;
}

export type IconName =
  | "activity"        // vitals / health
  | "server"          // VPS / server
  | "bot"             // agents
  | "list-checks"     // tasks
  | "more-horizontal" // more menu
  | "calendar-clock"  // hermes (scheduled)
  | "paperclip"       // paperclip
  | "layers"          // codex pool
  | "refresh-cw"      // refresh action
  | "check-circle"    // healthy
  | "alert-triangle"  // warning
  | "x-circle"        // error
  | "arrow-up-right"  // external link
  | "diamond"         // brand mark
  | "chevron-right"
  | "chevron-down"
  | "search"
  | "wifi"            // network
  | "cpu"             // cpu
  | "memory-stick"    // memory
  | "hard-drive"      // disk
  | "download"        // ingress
  | "upload"          // egress
  | "info";

const ICONS: Record<IconName, string> = {
  activity:        `<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`,
  server:          `<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><line x1="6" y1="7" x2="6.01" y2="7"/><line x1="6" y1="17" x2="6.01" y2="17"/>`,
  bot:             `<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 4v4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M8 20v2"/><path d="M16 20v2"/>`,
  "list-checks":   `<path d="M3 6h13"/><path d="M3 12h13"/><path d="M3 18h13"/><path d="M19 5l1.5 1.5L23 4"/><path d="M19 11l1.5 1.5L23 10"/><path d="M19 17l1.5 1.5L23 16"/>`,
  "more-horizontal":`<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>`,
  "calendar-clock":`<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><circle cx="18" cy="18" r="4"/><path d="M18 16.5V18l1 1"/>`,
  paperclip:       `<path d="M21 11l-9.5 9.5a5 5 0 1 1-7-7L14 4a3.5 3.5 0 1 1 5 5L9.5 18.5a2 2 0 1 1-3-3L15 7"/>`,
  zap:             `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  layers:          `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`,
  "refresh-cw":    `<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>`,
  "check-circle":  `<circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/>`,
  "alert-triangle":`<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>`,
  "x-circle":      `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
  "arrow-up-right":`<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>`,
  diamond:         `<path d="M12 2 22 12 12 22 2 12 12 2z"/>`,
  "chevron-right": `<polyline points="9 18 15 12 9 6"/>`,
  "chevron-down":  `<polyline points="6 9 12 15 18 9"/>`,
  search:          `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  wifi:            `<path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>`,
  cpu:             `<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>`,
  "memory-stick":  `<path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"/>`,
  "hard-drive":    `<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>`,
  download:        `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  upload:          `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
  info:            `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
};
