import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const reqHeaders = await headers();
    const session = await auth.api.getSession({ headers: reqHeaders });
    console.log("[root] role:", session?.user?.role ?? "no session");
    if (session?.user.role === "admin") redirect("/admin/dashboard");
  } catch (err) {
    console.error("[root] getSession threw:", err);
  }

  redirect("/order");
}
