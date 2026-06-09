export function escape(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function bytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function bytesPerSec(n: number, digits = 1): string {
  return `${bytes(n, digits)}/s`;
}

export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function pct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function ago(iso: string | number | undefined): string {
  if (iso == null) return "—";
  const t = typeof iso === "string" ? Date.parse(iso) : iso;
  if (!Number.isFinite(t)) return "—";
  const diff = (Date.now() - t) / 1000;
  if (diff < 0) return "—";
  if (diff < 45) return "just now";
  if (diff < 90) return "a minute ago";
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 5400) return "an hour ago";
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 172800) return "yesterday";
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 30 * 86400) return `${Math.floor(diff / (7 * 86400))} weeks ago`;
  const d = new Date(t);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function stamp(iso: string | number | undefined): string {
  if (iso == null) return "—";
  const t = typeof iso === "string" ? Date.parse(iso) : iso;
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

// Friendly relative or month-year date. Pair with `stamp()` in a title attribute for exact value.
export function friendlyDate(iso: string | number | null | undefined): string {
  if (iso == null) return "—";
  const t = typeof iso === "string" ? Date.parse(iso) : iso;
  if (!Number.isFinite(t)) return "—";
  const now = Date.now();
  const diff = (t - now) / 1000;
  const absDiff = Math.abs(diff);
  const d = new Date(t);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (absDiff < 60) return diff < 0 ? "just now" : "in a moment";
  if (absDiff < 5400) {
    const m = Math.round(absDiff / 60);
    return diff < 0 ? `${m} ${m === 1 ? "minute" : "minutes"} ago` : `in ${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  if (absDiff < 86400) {
    const h = Math.round(absDiff / 3600);
    return diff < 0 ? `${h} ${h === 1 ? "hour" : "hours"} ago` : `in ${h} ${h === 1 ? "hour" : "hours"}`;
  }
  if (absDiff < 7 * 86400) {
    const days = Math.round(absDiff / 86400);
    if (days === 1) return diff < 0 ? "yesterday" : "tomorrow";
    return diff < 0 ? `${days} days ago` : `in ${days} days`;
  }
  if (absDiff < 30 * 86400) {
    const w = Math.round(absDiff / (7 * 86400));
    return diff < 0 ? `${w} ${w === 1 ? "week" : "weeks"} ago` : `in ${w} ${w === 1 ? "week" : "weeks"}`;
  }
  if (absDiff < 365 * 86400) {
    return `${monthsShort[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Friendly bytes: "5.0 GB of 8 GB" or "1.2 GB / 100 GB"
export function bytesOf(used: number, total: number): string {
  return `${bytes(used)} of ${bytes(total)}`;
}

// Convert "final-check" or "paperclip-01541d1e" to display-friendly "Final check" / "Paperclip 01541d1e".
// Keeps trailing slug-style hashes intact since title-casing them is meaningless.
export function titleCase(slug: string): string {
  if (!slug) return slug;
  // Split on - or _, capitalize first word only, leave hex-looking trailing tokens as-is.
  const parts = slug.split(/[-_]/);
  const isHexish = (s: string) => /^[0-9a-f]{6,}$/i.test(s) || /^\d+$/.test(s);
  return parts
    .map((p, i) => {
      if (isHexish(p)) return p;
      if (i === 0) return p.charAt(0).toUpperCase() + p.slice(1);
      return p; // keep lowercase for subsequent tokens for sentence-case feel
    })
    .join(" ");
}

// Friendly duration: "2 days, 4 hours"
export function friendlyDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 seconds";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${d} ${d === 1 ? "day" : "days"}, ${h} ${h === 1 ? "hour" : "hours"}` : `${d} ${d === 1 ? "day" : "days"}`;
  if (h > 0) return m > 0 ? `${h} ${h === 1 ? "hour" : "hours"}, ${m} min` : `${h} ${h === 1 ? "hour" : "hours"}`;
  if (m > 0) return `${m} ${m === 1 ? "minute" : "minutes"}`;
  return `${Math.floor(seconds)} seconds`;
}

export function sparkline(values: number[], opts: { width?: number; height?: number; stroke?: string; fill?: string; min?: number; max?: number; autoScale?: boolean } = {}): string {
  const width = opts.width ?? 120;
  const height = opts.height ?? 28;
  if (values.length === 0) return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"></svg>`;
  // Auto-scale: when caller doesn't pin min/max, expand around the data so variation is visible.
  // Even small jitter in a stable metric should show movement.
  let min: number;
  let max: number;
  if (opts.autoScale !== false && opts.min === undefined && opts.max === undefined) {
    const dMin = Math.min(...values);
    const dMax = Math.max(...values);
    const dRange = dMax - dMin;
    if (dRange < 0.5) {
      // Nearly flat — fabricate a small visual range around the value
      const center = (dMin + dMax) / 2;
      const pad = Math.max(1, Math.abs(center) * 0.05);
      min = center - pad;
      max = center + pad;
    } else {
      const pad = dRange * 0.15;
      min = dMin - pad;
      max = dMax + pad;
    }
  } else {
    min = opts.min ?? Math.min(...values);
    max = opts.max ?? Math.max(...values);
  }
  const range = max - min || 1;
  const pad = 2;
  const usable = height - pad * 2;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const coords = values.map((v, i) => {
    const x = i * stepX;
    const y = height - pad - ((v - min) / range) * usable;
    return [x, y] as const;
  });
  // Smooth curve via quadratic bezier midpoints
  const pathParts: string[] = [];
  coords.forEach(([x, y], i) => {
    if (i === 0) pathParts.push(`M${x.toFixed(1)},${y.toFixed(1)}`);
    else {
      const [px, py] = coords[i - 1];
      const cx = (px + x) / 2;
      const cy = (py + y) / 2;
      pathParts.push(`Q${px.toFixed(1)},${py.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`);
      if (i === coords.length - 1) pathParts.push(`T${x.toFixed(1)},${y.toFixed(1)}`);
    }
  });
  const path = pathParts.join(" ");
  const areaPath = `${path} L${(coords[coords.length - 1][0]).toFixed(1)},${height} L0,${height} Z`;
  const stroke = opts.stroke ?? "currentColor";
  const fill = opts.fill ?? "currentColor";
  return `
<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
  <path d="${areaPath}" fill="${fill}" fill-opacity="0.10" stroke="none" />
  <path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
</svg>`.trim();
}

export function statusDot(state: string): string {
  const tone = ["active", "running", "ok", "success", "valid"].includes(state) ? "ok"
    : ["failed", "error", "danger"].includes(state) ? "bad"
    : ["inactive", "missing", "unknown"].includes(state) ? "dim"
    : "warn";
  return `<span class="dot dot-${tone}" aria-hidden="true"></span>`;
}
