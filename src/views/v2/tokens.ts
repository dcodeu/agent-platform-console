/**
 * Y2 design tokens — mirrors tokens.css 1:1.
 *
 * Use these from JS/TS contexts that can't read CSS custom properties
 * (e.g. inline SVG attribute strings, canvas drawing, chart axis colors).
 * For CSS, prefer `var(--token-name)` from tokens.css.
 */
export const tokens = {
  // Neutrals (warm-charcoal, low chroma at hue 200)
  bg0: 'oklch(0.155 0.005 200)',
  bg1: 'oklch(0.195 0.006 200)',
  bg2: 'oklch(0.235 0.007 200)',
  bg3: 'oklch(0.295 0.008 200)',
  rule: 'oklch(0.31 0.010 200)',
  ruleHi: 'oklch(0.42 0.012 200)',
  fg: 'oklch(0.96 0.005 200)',
  fg2: 'oklch(0.78 0.006 200)',
  fg3: 'oklch(0.58 0.006 200)',
  fg4: 'oklch(0.42 0.006 200)',

  // accent (teal): brand · healthy · live · CTA · primary chart series
  accent: 'oklch(0.82 0.110 195)',
  accentBg: 'oklch(0.82 0.110 195 / 0.14)',
  accentLine: 'oklch(0.82 0.110 195 / 0.42)',

  // attn (coral, warm): "needs your attention" — approvals, codex partial
  attn: 'oklch(0.78 0.095 35)',
  attnBg: 'oklch(0.78 0.095 35 / 0.14)',
  attnLine: 'oklch(0.78 0.095 35 / 0.42)',
  // Solid surface for the approval banner — coral-tinted dark, opaque
  attnSurface: 'oklch(0.215 0.030 35)',

  // alert (red): broken — used very sparingly
  alert: 'oklch(0.70 0.190 25)',
  alertBg: 'oklch(0.70 0.190 25 / 0.14)',

  // viz-dim (warm gray-tan): chart secondary series (dashed only)
  vizDim: 'oklch(0.68 0.040 60)',

  // Font stacks
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",

  // Layout heights
  topbarH: '48px',
  subnavH: '40px',
  bnavH: '58px',
  safeTop: 'env(safe-area-inset-top, 0px)',
  safeBottom: 'env(safe-area-inset-bottom, 0px)',
} as const;

export type Token = keyof typeof tokens;
