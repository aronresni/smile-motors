import type { SVGProps } from "react";

/**
 * Iconografía ÚNICA de la aplicación (vendedor + admin). Trazo, 24x24, `currentColor`.
 * Inline para no añadir dependencias.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function svgProps({ size = 20, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  };
}

export function HomeIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function ReceiptIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function BoxesIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z" />
      <path d="M3 13.5 12 18l9-4.5M3 8.5v5M21 8.5v5M12 13v5" />
    </svg>
  );
}

export function MenuGridIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function ChevronLeftIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function TrendUpIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 17 10 11l4 4 6-7" />
      <path d="M15 8h5v5" />
    </svg>
  );
}

export function TrendDownIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 7 10 13l4-4 6 7" />
      <path d="M15 16h5v-5" />
    </svg>
  );
}

export function DashIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M6 12h12" />
    </svg>
  );
}

export function TargetIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

export function WalletIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 7a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v2" />
      <path d="M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6" />
      <circle cx="16.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LayersIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 4 3 9l9 5 9-5-9-5Z" />
      <path d="M3 14l9 5 9-5" />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * Iconos de navegación / acciones (admin + vendedor). Mismo trazo y grilla.
 * ------------------------------------------------------------------------ */
export function DashboardIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="4" y="4" width="7" height="9" rx="1.5" />
      <rect x="13" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="11" width="7" height="9" rx="1.5" />
      <rect x="4" y="15" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 19.5c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M17.5 15.2c1.7.6 3 2 3.5 4.3" />
    </svg>
  );
}

export function UserPlusIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c.8-3 3.2-4.5 6.5-4.5 1.4 0 2.7.3 3.7.9" />
      <path d="M18 14v6M15 17h6" />
    </svg>
  );
}

export function PackageIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z" />
      <path d="M4 7.5 12 11l8-3.5M12 11v9M8 5.8l8 3.5" />
    </svg>
  );
}

export function BankIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M3.5 9 12 4l8.5 5" />
      <path d="M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8M3.5 20h17" />
    </svg>
  );
}

export function PercentIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M18 6 6 18" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  );
}

export function ActivityIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </svg>
  );
}

export function AlertTriangleIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </svg>
  );
}

export function ChartBarIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 20h16" />
      <rect x="5.5" y="11" width="3" height="6" rx="0.75" />
      <rect x="10.5" y="7" width="3" height="10" rx="0.75" />
      <rect x="15.5" y="4" width="3" height="13" rx="0.75" />
    </svg>
  );
}

export function TruckIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M3 6.5h11v9H3zM14 9.5h3.5L21 13v2.5h-7" />
      <circle cx="7" cy="17.5" r="1.75" />
      <circle cx="17" cy="17.5" r="1.75" />
    </svg>
  );
}

export function CheckCircleIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-5" />
    </svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function XIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function AlertCircleIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5M12 16h.01" />
    </svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

export function MenuIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function LogOutIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l-4-4 4-4M6 12h10" />
    </svg>
  );
}

export function PencilIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 3.5 5 6v5.5c0 4.3 3 7.8 7 9 4-1.2 7-4.7 7-9V6l-7-2.5Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function ArrowRightIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function BarcodeIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 6v12M7 6v12M11 6v12M14 6v12M18 6v12M20.5 6v12" />
    </svg>
  );
}

export function FileTextIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5l-5-5Z" />
      <path d="M14 3.5v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

export function CreditCardIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </svg>
  );
}

export function HistoryIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4l3 2" />
    </svg>
  );
}

export function UserIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5" />
    </svg>
  );
}

export function MapPinIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function NoteIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M5 4.5h14v10l-5 5H5z" />
      <path d="M14 19.5v-5h5M8.5 9h7M8.5 12.5h4" />
    </svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 1.8h6A2 2 0 0 0 17 19l1-12M9 7V4.5h6V7" />
    </svg>
  );
}

export function RefreshIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5" />
    </svg>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function CalculatorIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 7h8" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </svg>
  );
}

export function ImageIcon(p: IconProps) {
  return (
    <svg {...svgProps(p)}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 4.5-4.5a1.5 1.5 0 0 1 2 0L15 17M14 14l1.8-1.8a1.5 1.5 0 0 1 2.1 0L20 14.2" />
    </svg>
  );
}
