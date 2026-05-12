import Link from "next/link";
import styles from "./page.module.css";

const sections = [
  {
    href: "/admin/users",
    title: "User Management",
    description: "View and manage all registered users.",
  },
  {
    href: "/admin/merchants",
    title: "Merchant Management",
    description: "Browse all active merchant profiles.",
  },
  {
    href: "/admin/review",
    title: "Application Review",
    description: "Review pending merchant applications.",
  },
];

export default function AdminDashboard() {
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Admin Dashboard</h1>
      <div className={styles.grid}>
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className={styles.card}>
            <p className={styles.cardTitle}>{s.title}</p>
            <p className={styles.cardDesc}>{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
