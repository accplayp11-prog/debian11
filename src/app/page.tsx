import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";

export default async function RootPage() {
  // Server-side: check if already authenticated
  const session = await getServerSession();
  if (session) {
    redirect("/terminal");
  } else {
    redirect("/login");
  }
}
