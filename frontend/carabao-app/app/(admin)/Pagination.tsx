"use client";

import styles from "./pagination.module.css";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
};

export default function Pagination({ page, pageSize, total, disabled, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className={styles.pager}>
      <span className={styles.info}>
        {start}–{end} of {total}
      </span>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.btn}
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className={styles.info}>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className={styles.btn}
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
