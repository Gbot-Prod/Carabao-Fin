import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  let role: string | null = null;

  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    role = session?.user?.role ?? null;
  } catch {
    // getSession failure — fall through to /order
  }

  if (role === "admin") redirect("/admin/dashboard");
  redirect("/order");
}
