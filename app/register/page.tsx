import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { currentLocale } from "@/lib/i18n/server";
import { getAuthDictionary } from "@/lib/i18n/auth";

export async function generateMetadata(): Promise<Metadata> { return { title: getAuthDictionary(await currentLocale()).registerTitle }; }
export default async function RegisterPage() {
  const t = getAuthDictionary(await currentLocale());
  return <AuthShell mode="register"><AuthForm mode="register" t={t}/></AuthShell>;
}
