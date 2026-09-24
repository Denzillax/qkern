import { ConsoleApp } from "@/components/console/console-app";
import { currentLocale } from "@/lib/i18n/server";

export const metadata = { title: "QKERN Console" };

export default async function ConsolePage() {
  return <ConsoleApp locale={await currentLocale()} />;
}
