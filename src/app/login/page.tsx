import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export default async function LoginPage() {
  // If already authenticated, redirect to terminal
  const session = await getServerSession();
  if (session) {
    redirect("/terminal");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.12) 0%, #0a0a0f 65%)",
        padding: "1rem",
      }}
    >
      <LoginForm />
    </main>
  );
}
