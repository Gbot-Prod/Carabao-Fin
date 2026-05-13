import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import { auth } from "@/lib/auth";
import AdminSidebar from "./AdminSidebar";
import styles from "./layout.module.css";

const getSessionCached = unstable_cache(
  async (token: string) => {
    const h = new Headers({ cookie: `better-auth.session_token=${token}` });
    return auth.api.getSession({ headers: h });
  },
  ["admin-session"],
  { revalidate: 60 }
);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("better-auth.session_token")?.value;

  if (!sessionToken) redirect("/auth");

  const session = await getSessionCached(sessionToken);

  if (!session || session.user.role !== "admin") {
    redirect("/");
  }

  return (
    <div className={styles.shell}>
      <AdminSidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
