import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import AdminDashboard from "@/components/AdminDashboard";

export default async function AdminPage() {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  if (!session.isAdmin) {
    redirect("/terminal");
  }

  return <AdminDashboard username={session.username} />;
}
