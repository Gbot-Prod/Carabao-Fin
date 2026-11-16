// R4: the admin sign-in page. Outside app/(admin)/layout.tsx, which sends
// every visitor without an admin session to this page.
export default function AdminAuthLayout({ children }: { children: React.ReactNode }) {
  return <main>{children}</main>;
}
