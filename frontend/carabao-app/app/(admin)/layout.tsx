import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import AdminSidebar from "./AdminSidebar";
import styles from "./layout.module.css";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session || session.user.role !== "admin") {
    redirect("/auth");
  }

  return (
    <div className={styles.shell}>
      <AdminSidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
