import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { unstable_cache } from "next/cache";
import { auth } from "@/lib/auth";

const getSessionCached = unstable_cache(
  async (token: string) => {
    const h = new Headers({ cookie: `better-auth.session_token=${token}` });
    return auth.api.getSession({ headers: h });
  },
  ["root-session"],
  { revalidate: 60 },
);

export default async function Home() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("better-auth.session_token")?.value;

  if (!sessionToken) redirect("/auth");

  const session = await getSessionCached(sessionToken);

  if (!session) redirect("/auth");

  if (session.user.role === "admin") redirect("/admin/dashboard");

  redirect("/order");
}
