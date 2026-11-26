import type { SVGProps } from "react";

type Props = Omit<SVGProps<SVGSVGElement>, "strokeWidth"> & {
  size?: number;
  strokeWidth?: number;
};

/**
 * Support agent icon: headset with a chat bubble inside. Drop-in for a
 * lucide-react icon (same size / strokeWidth props, currentColor stroke).
 */
export default function SupportIcon({ size = 24, strokeWidth = 2, ...rest }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {/* headband */}
      <path d="M4 12a8 8 0 0 1 16 0" />
      {/* ear cups */}
      <rect x="2.5" y="12" width="3" height="6" rx="1.5" fill="currentColor" />
      <rect x="18.5" y="12" width="3" height="6" rx="1.5" fill="currentColor" />
      {/* mic boom */}
      <path d="M20 18a3 3 0 0 1-3 3h-2.5" />
      <circle cx="13.5" cy="21" r="1.25" fill="currentColor" />
      {/* chat bubble with dots */}
      <path d="M10.31 16.13A4 4 0 1 0 8.24 13.87L7.8 16.9Z" />
      <path d="M10.4 12.5h.01M12 12.5h.01M13.6 12.5h.01" />
    </svg>
  );
}
