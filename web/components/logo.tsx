/**
 * The Mmiri mark.
 *
 * A drop, filled to a level, with the strike cutting across it. That is the whole
 * product in one shape: rain accumulates, a threshold decides, and what sits under the
 * line is what pays. The fill is water blue, the shortfall beneath the line is harmattan
 * ochre — the same two colours that mean the same two things everywhere else on the site,
 * so the mark teaches the legend before the chart has to.
 *
 * Drawn to read at 20px: one silhouette, one rule, no interior detail that closes up.
 */
export function Mark({ size = 28 }: { size?: number }) {
  const id = "mmiri-drop";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={id}>
          <path d="M16 2.5c0 0 10.5 11.2 10.5 17.1A10.5 10.5 0 0 1 5.5 19.6C5.5 13.7 16 2.5 16 2.5z" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id})`}>
        {/* the season's water */}
        <rect x="0" y="12" width="32" height="20" fill="var(--rain)" />
        {/* the shortfall: everything under the strike */}
        <rect x="0" y="21" width="32" height="11" fill="var(--dust)" />
      </g>

      {/* the drop itself */}
      <path
        d="M16 2.5c0 0 10.5 11.2 10.5 17.1A10.5 10.5 0 0 1 5.5 19.6C5.5 13.7 16 2.5 16 2.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* the strike */}
      <path d="M3 21h26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <Mark size={size} />
      <span className="logo-word">Mmiri</span>
    </span>
  );
}
