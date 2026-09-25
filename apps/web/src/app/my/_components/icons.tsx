import type { ReactNode } from "react"

// Stroke icons on a 24px grid, same weight and caps as QueueTracker's step
// icons, so the dashboard reads as one hand. Decorative: the text beside each
// one carries the meaning.
function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const TicketIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
    <path d="M15 5v2m0 3v2m0 3v2" />
  </Icon>
)

export const CalendarIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4M8 14h3" />
  </Icon>
)

/** A paper slip with a scan line: the reception ticket being claimed. */
export const ScanIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M4 12h16" />
  </Icon>
)

export const ProfileIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Icon>
)

export const ArrowIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
)

export const SearchIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
)

export const ClockIcon = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)

export const CloseIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const PhoneOffIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="7" y="2.5" width="10" height="19" rx="2" />
    <path d="M11 18.5h2M3 3l18 18" />
  </Icon>
)
