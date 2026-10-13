import React from "react";

export interface PinselaLogoProps {
  /** Mark size in px (the tile is square). */
  size?: number;
  /** Render the "Pinsela" wordmark text next to the mark. */
  wordmark?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Pinsela mark: near-black tile with a light brush swash. Single source for every logo in the app. */
export const PinselaMark: React.FC<{ size?: number; className?: string }> = ({ size = 24, className }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 64 64"
    role="img"
    aria-label="Pinsela"
    style={{ display: "block", flexShrink: 0 }}
  >
    <rect width="64" height="64" rx="15" fill="#141414" />
    <path d="M15 37C20 22 34 15 50 21" fill="none" stroke="#f5f5f5" strokeWidth="13" strokeLinecap="round" />
    <path d="M18 49C29 44 40 45 48 41" fill="none" stroke="#f5f5f5" strokeWidth="6" strokeLinecap="round" opacity=".6" />
  </svg>
);

export const PinselaLogo: React.FC<PinselaLogoProps> = ({ size = 24, wordmark = true, className = "", style }) => (
  <span
    className={`pinsela-logo ${className}`.trim()}
    style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.4), ...style }}
  >
    <PinselaMark size={size} />
    {wordmark ? (
      <span
        className="pinsela-logo-text"
        style={{
          fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
          fontWeight: 600,
          fontSize: Math.round(size * 0.75),
          letterSpacing: "-0.01em",
          lineHeight: 1,
          color: "inherit",
        }}
      >
        Pinsela
      </span>
    ) : null}
  </span>
);
