"use client";

import { AlertTriangle, ArrowRight, Boxes, CreditCard, KeyRound, ShieldCheck, Sliders, Users } from "lucide-react";
import { t } from "@/components/console/console-i18n";
import { CopyValue } from "@/components/console/copy-value";
import type { ViewId } from "@/components/console/navigation";
import { SETTINGS_GROUPS, navPath, type SettingsGroupId } from "@/lib/console/settings-groups";

/**
 * Einstellungen → Allgemein, als Übersicht über die Gruppen (2.139).
 *
 * **Was vorher stand.** Eine zweite Navigation aus sechs Reitern, fünf davon
 * abgeschaltet, daneben drei Eingabefelder mit `readOnly` und ein
 * Speicherknopf, der nichts speichert. Die Reiterspalte sagte dasselbe wie
 * die Seitenleiste, nur falsch: "Umgebungen" und "API-Keys" sind längst
 * eigene Seiten, "Team" und "Gefahrenzone" gibt es gar nicht.
 *
 * **Was jetzt steht.** Die sieben Gruppen des Auftrags, jede mit dem, was
 * dieses Projekt wirklich führt. Wo eine Sache eine eigene Seite hat, führt
 * ein Verweis dorthin; die Zuordnung liegt in `lib/console/settings-groups`
 * und nicht im Markup. Zwei Gruppen haben keine Fähigkeit und sagen das als
 * Satz: Eine Teamverwaltung gibt es nicht, und ein Projekt löschen,
 * zurücksetzen oder pausieren kann keine Route dieser Console.
 *
 * **Warum kein Eingabefeld mehr.** Ein `readOnly`-Feld sieht aus wie ein
 * Formular und ist keines. Die technischen Werte stehen jetzt als Text mit
 * dem einen Kopier-Knopf aus `copy-value.tsx` daneben.
 *
 * **Warum `navigate` optional ist.** Die Schale `console-app.tsx` reicht die
 * Requisite heute nicht herein; sie gehört einem anderen Schnitt. Bis sie
 * verdrahtet ist, bleiben die Verweise stumm, statt dass die Seite nicht
 * baut.
 */
export function SettingsView({ project, organizationId, navigate }: {
  project: { name: string; id: string; region?: string };
  organizationId: string;
  navigate?: (view: ViewId) => void;
}) {
  /** Titel, Symbol und der Satz, der sagt, was die Gruppe enthält. */
  const texts: Record<SettingsGroupId, { title: string; lead: string; icon: typeof Sliders }> = {
    general: {
      title: t("Allgemein"), icon: Sliders,
      lead: t("Der Name dieses Projekts, seine Kennungen und die Darstellung der Console. Ein Umbenennen gibt es hier nicht, weil keine Route den Namen eines Projekts ändert."),
    },
    infrastructure: {
      title: t("Infrastruktur"), icon: Boxes,
      lead: t("Worauf dieses Projekt läuft. Region, Postgres-Version und Grösse stehen unter Infrastruktur, bestellbare Grössen unter Compute und Disk, und die verknüpften Dienste unter Integrationen."),
    },
    "api-keys": {
      title: t("API-Keys"), icon: KeyRound,
      lead: t("Die Schlüssel dieses Projekts und die Endpunkte, die sie öffnen. Angelegt und widerrufen werden sie auf ihrer eigenen Seite und nicht in dieser Übersicht."),
    },
    security: {
      title: t("Sicherheit"), icon: ShieldCheck,
      lead: t("Der Sicherheitsberater liest das Schema dieses Projekts, Passwortschutz und Mehrfaktor härten die Anmeldung, und das Audit-Log sagt, wer wann was getan hat."),
    },
    billing: {
      title: t("Abrechnung"), icon: CreditCard,
      lead: t("Tarif, Verbrauch und Zusatzleistungen. Die Beträge kommen aus der Abrechnung dieses Projekts, nicht aus einer Preisliste in dieser Ansicht."),
    },
    team: {
      title: t("Team"), icon: Users,
      lead: t("Eine Teamverwaltung gibt es in QKERN nicht. Es gibt keine Mitgliederliste, keine Einladungen und keine Rollen für Personen, und darum ist der Knopf dafür in der Seitenleiste abgeschaltet. Wer dieses Projekt erreicht, erreicht es über einen API-Key, und was dabei geschah, steht im Audit-Log."),
    },
    danger: {
      title: t("Gefahrenzone"), icon: AlertTriangle,
      lead: t("Ein Projekt löschen, zurücksetzen oder pausieren kann diese Console nicht, denn keine Route trägt eine dieser Aktionen. Zerstörend wirkt hier nur das Einzelne, und jedes davon liegt auf seiner eigenen Seite: die Zeilen einer Tabelle, ein Bucket mit seinen Objekten, ein API-Key, eine Function, ein Cron-Job, ein Webhook."),
    },
  };

  /** Ein kopierbarer technischer Wert. Der Knopf ist der eine aus `copy-value`. */
  function value(label: string, content: string) {
    return <div className="settings-value">
      <span>{label}</span>
      <code>{content}</code>
      <CopyValue value={content} className="secondary-button settings-value-copy"
        labels={{ copy: t("Kopieren"), copied: t("Kopiert"), failed: t("Kopieren hat nicht geklappt") }}/>
    </div>;
  }

  return <div className="settings-groups">
    <header className="console-card settings-groups-head">
      <span className="console-kicker">{t("Projekteinstellungen")}</span>
      <h2>{project.name}</h2>
      <p>{t("Diese Übersicht ordnet die Einstellungen dieses Projekts in sieben Gruppen und nennt je Gruppe, was es wirklich gibt. Jeder Verweis führt auf eine Seite, die es gibt; wo eine Gruppe nichts führt, steht ein Satz und kein Knopf.")}</p>
    </header>
    {SETTINGS_GROUPS.map((group) => {
      const { title, lead, icon: Icon } = texts[group.id];
      return <article key={group.id} className={`console-card settings-group${group.id === "danger" ? " is-danger" : ""}`}>
        <div className="settings-group-head"><Icon size={16} aria-hidden/><h3>{title}</h3></div>
        <p>{lead}</p>
        {group.id === "general" && <div className="settings-group-values">
          {value(t("Projekt-ID"), project.id)}
          {value(t("Organisations-ID"), organizationId)}
          {/* Die Region steht in der Projektzeile, die Schale reicht sie heute
              aber nicht herein. Ohne Wert keine Zeile, statt eines Striches. */}
          {project.region !== undefined && value(t("Region"), project.region)}
        </div>}
        {group.views.length > 0 && <div className="settings-group-links">
          {group.views.map((view) => {
            const path = navPath(view);
            // Eine Menuegruppe ohne Kinder traegt denselben Namen zweimal;
            // "Table Editor · Table Editor" waere kein Weg, sondern ein Echo.
            const name = path.group === path.label ? t(path.group) : `${t(path.group)} · ${t(path.label)}`;
            return <button key={view} type="button" className="secondary-button" onClick={() => navigate?.(view)}>
              {name} <ArrowRight size={13} aria-hidden/>
            </button>;
          })}
        </div>}
      </article>;
    })}
  </div>;
}
