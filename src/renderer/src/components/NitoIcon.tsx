interface NitoIconProps {
  size?: number | string
  className?: string
}

export default function NitoIcon({ size = 32, className }: NitoIconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="32" cy="32" r="30" fill="#6366f1" />
      <circle cx="32" cy="32" r="30" fill="url(#nito-grad)" />
      <ellipse cx="32" cy="22" rx="16" ry="10" fill="#1a1a2e" />
      <path d="M18 22c0-8 6-14 14-14s14 6 14 14" fill="#1a1a2e" />
      <path d="M17 24c2-6 8-10 15-10s13 4 15 10" fill="#2d2d4a" />
      <ellipse cx="25" cy="20" rx="2.5" ry="1.5" fill="#818cf8" opacity="0.5" />
      <ellipse cx="39" cy="19" rx="2" ry="1" fill="#818cf8" opacity="0.4" />
      <circle cx="46" cy="17" r="2.5" fill="#a78bfa" />
      <circle cx="46.5" cy="16.5" r="0.8" fill="#c4b5fd" />
      <circle cx="32" cy="36" r="14" fill="#fde8d7" />
      <path d="M20 32c0-2 1-4 3-5s4-2 6-2" stroke="#e8c4b8" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.3" />
      <ellipse cx="24" cy="38" rx="4" ry="2.5" fill="#f5a0b8" opacity="0.5" />
      <ellipse cx="40" cy="38" rx="4" ry="2.5" fill="#f5a0b8" opacity="0.5" />
      <ellipse cx="26" cy="35" rx="2.5" ry="3" fill="#1a1a2e" />
      <ellipse cx="38" cy="35" rx="2.5" ry="3" fill="#1a1a2e" />
      <circle cx="27" cy="34" r="1" fill="#ffffff" />
      <circle cx="39" cy="34" r="1" fill="#ffffff" />
      <path d="M29 41 Q32 44 35 41" stroke="#d48090" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <defs>
        <radialGradient id="nito-grad" cx="20" cy="20" r="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#4f46e5" />
        </radialGradient>
      </defs>
    </svg>
  )
}
