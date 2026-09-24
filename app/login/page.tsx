import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { currentLocale } from "@/lib/i18n/server";
import { getAuthDictionary } from "@/lib/i18n/auth";

export async function generateMetadata(): Promise<Metadata> { return { title: getAuthDictionary(await currentLocale()).loginTitle }; }
export default async function LoginPage() {
  const t = getAuthDictionary(await currentLocale());
  return <AuthShell mode="login"><AuthForm mode="login" t={t}/></AuthShell>;
}
