import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import TerminalDashboard from "@/components/TerminalDashboard";

export default async function TerminalPage() {
  const session = await getServerSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <TerminalDashboard
      username={session.username}
      isAdmin={session.isAdmin}
    />
  );
}
