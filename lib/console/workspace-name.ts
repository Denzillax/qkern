/**
 * Der Workspace-Name entsteht beim ersten Login automatisch aus der E-Mail
 * ("denis.mihaljevic Workspace"). In der Console soll er lesbar sein:
 * "Denis Mihaljevic" — das Wort "Workspace" traegt die Krume als Etikett.
 */
export function displayWorkspaceName(name: string | null | undefined): string {
  if (!name) return "QKERN";
  const base = name.replace(/\s+Workspace$/i, "").trim();
  if (!base) return name.trim();
  return base
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
