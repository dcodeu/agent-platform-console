/**
 * Lucide icon sprite (Y2 redesign).
 *
 * Mount <IconSprite /> once near the root of the app (it renders a hidden
 * <svg> containing <symbol> definitions). Then use <Icon name="..." />
 * anywhere — it renders <svg><use href="#i-<name>"/></svg>.
 *
 * All icons inherit color from `currentColor` and default to 18×18.
 */
import type { CSSProperties } from 'react';

export const ICON_NAMES = [
  'menu',
  'search',
  'flag',
  'check',
  'layout-dashboard',
  'wallet',
  'dollar-sign',
  'message-circle',
  'send',
  'activity',
  'radio',
  'more-horizontal',
  'paperclip',
  'triangle-alert',
  'mail',
  'x-circle',
  'refresh-cw',
  'trending-up',
  'bell',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/**
 * Hidden SVG sprite. Mount once at the root of the app, e.g.:
 *
 *   <body>
 *     <IconSprite />
 *     <App />
 *   </body>
 */
export function IconSprite() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'none' }}
      aria-hidden="true"
    >
      <symbol id="i-menu" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M4 5h16M4 12h16M4 19h16"
        />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="m21 21l-4.34-4.34" />
          <circle cx="11" cy="11" r="8" />
        </g>
      </symbol>
      <symbol id="i-flag" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"
        />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M20 6L9 17l-5-5"
        />
      </symbol>
      <symbol id="i-layout-dashboard" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </g>
      </symbol>
      <symbol id="i-wallet" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
          <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
        </g>
      </symbol>
      <symbol id="i-dollar-sign" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M12 2v20m5-17H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
        />
      </symbol>
      <symbol id="i-message-circle" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092a10 10 0 1 0-4.777-4.719"
        />
      </symbol>
      <symbol id="i-send" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zm7.318-19.539l-10.94 10.939"
        />
      </symbol>
      <symbol id="i-activity" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
        />
      </symbol>
      <symbol id="i-radio" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="M16.247 7.761a6 6 0 0 1 0 8.478m2.828-11.306a10 10 0 0 1 0 14.134m-14.15 0a10 10 0 0 1 0-14.134m2.828 11.306a6 6 0 0 1 0-8.478" />
          <circle cx="12" cy="12" r="2" />
        </g>
      </symbol>
      <symbol id="i-more-horizontal" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </g>
      </symbol>
      <symbol id="i-paperclip" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="m16 6l-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"
        />
      </symbol>
      <symbol id="i-triangle-alert" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"
        />
      </symbol>
      <symbol id="i-mail" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="m22 7l-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
          <rect width="20" height="16" x="2" y="4" rx="2" />
        </g>
      </symbol>
      <symbol id="i-x-circle" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m15 9l-6 6m0-6l6 6" />
        </g>
      </symbol>
      <symbol id="i-refresh-cw" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5m5 4a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </g>
      </symbol>
      <symbol id="i-trending-up" viewBox="0 0 24 24">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="M16 7h6v6" />
          <path d="m22 7l-8.5 8.5l-5-5L2 17" />
        </g>
      </symbol>
      <symbol id="i-bell" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M10.268 21a2 2 0 0 0 3.464 0m-10.47-5.674A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
        />
      </symbol>
    </svg>
  );
}

export interface IconProps {
  /** Icon name — must match a symbol id from {@link ICON_NAMES}. */
  name: IconName;
  /** Width and height in px. Default 18. */
  size?: number;
  /** Optional className passed through to the <svg>. */
  className?: string;
  /**
   * If provided, the icon is labelled for assistive tech (role="img").
   * If omitted, the icon is treated as decorative (aria-hidden).
   */
  'aria-label'?: string;
  /** Optional inline style passthrough. */
  style?: CSSProperties;
}

/**
 * Render a Lucide icon from the sprite. Color follows `currentColor`.
 */
export function Icon({
  name,
  size = 18,
  className,
  'aria-label': ariaLabel,
  style,
}: IconProps) {
  const labelled = typeof ariaLabel === 'string' && ariaLabel.length > 0;
  return (
    <svg
      width={size}
      height={size}
      className={className}
      style={style}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? ariaLabel : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
