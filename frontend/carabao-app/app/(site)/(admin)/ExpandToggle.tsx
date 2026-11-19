import styles from "./details.module.css";

type Props = {
  expanded: boolean;
  controls: string;
  label: string;
  onToggle: () => void;
};

/** Chevron button that opens or closes a detail row in an admin table. */
export default function ExpandToggle({ expanded, controls, label, onToggle }: Props) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={`${expanded ? "Hide" : "Show"} details for ${label}`}
      title={expanded ? "Hide details" : "Show details"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg className={styles.chevron} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export const formatDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
};

export const formatDateTime = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
