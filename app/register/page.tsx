import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata = { title: "Account erstellen · QKERN" };
export default function RegisterPage() { return <AuthShell mode="register"><AuthForm mode="register"/></AuthShell>; }
