import { redirect } from "next/navigation";

// The buyer home. The admin deploy never shows this page: proxy.ts rewrites
// "/" there to /admin/dashboard.
export default function Home() {
  redirect("/order");
}
