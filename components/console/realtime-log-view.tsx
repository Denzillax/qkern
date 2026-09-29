"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Radio, RefreshCw, Send, Unplug, Waves } from "lucide-react";
import { t, tAll } from "@/components/console/console-i18n";
import { formatMoment, formatNumber } from "@/components/console/console-display";
import { StableLabel } from "@/components/stable-label";
import {
  REALTIME_CHANNEL_COLUMNS,
  REALTIME_LOG_STATES,
  REALTIME_LOG_TEXTS,
  REALTIME_MESSAGE_COLUMNS,
  REALTIME_ROLE_LABELS,
  type RealtimeActorRoleId,
} from "@/lib/console/realtime-log-texts";

/**
 * Logs → Realtime (2.86): die ehrliche Antwort auf einen Platzhalter, der
 * „Verbindungen, Kanaele und Nachrichten ueber die Zeit" versprochen hat.
 *
 * Zwei der drei Dinge gibt es, und sie stehen hier als Zahlen aus der
 * Datenbank: die Kanaele aus `realtime_channel_sequences`, die Nachrichten aus
 * `realtime_events`. Das dritte gibt es nicht, und dafuer steht ein Satz und
 * keine Kachel: Verbindungen fuehrt der Realtime-Prozess in einer Map im
 * eigenen Speicher, und die verlaesst ihn nie.
 *
 * Dazu die Zahl, die im Betrieb wirklich zaehlt und die der Platzhalter nicht
 * versprochen hat: der Rueckstand des Aenderungs-Feeds, gezaehlt in der
 * Projektdatenbank gegen die Position aus der Kontrollebene.
 *
 * Der Feed ist die zweite Haelfte und darf die erste nicht mitreissen:
 * Antwortet die Projektdatenbank nicht, sagt die Karte warum, und die Kanaele
 * stehen trotzdem da.
 *
 * Nur lesend: ein GET, kein Schreibverb.
 */
type Environment = "development" | "staging" | "production";

type ChannelEntry = {
  channel: string;
  stored: number;
  assigned: number;
  firstSequence: number | null;
  lastSequence: number | null;
  firstCreatedAt: string | null;
  lastCreatedAt: string | null;
  counterUpdatedAt: string;
  byRole: Record<RealtimeActorRoleId, number>;
};

type MessageEntry = {
  channel: string;
  sequence: number;
  event: string;
  actorRole: RealtimeActorRoleId;
  createdAt: string;
  payloadBytes: number;
};

type FeedReading = {
  present: boolean;
  rows: number;
  backlog: number;
  oldestPosition: number | null;
  newestPosition: number | null;
  oldestCommittedAt: string | null;
  newestCommittedAt: string | null;
  byOperation: { insert: number; update: number; delete: number };
  capturedTables: number;
};

type Reading = {
  channels: ChannelEntry[];
  channelsTruncated: boolean;
  messages: MessageEntry[];
  messagesTruncated: boolean;
  cursor: { position: number; updatedAt: string } | null;
  feed: FeedReading | null;
  feedState: "read" | "disabled" | "not_ready" | "unavailable";
};

type State = "loading" | "ready" | "error";

export function RealtimeLogView({ projectId, environment, initialState }: { projectId: string; environment: Environment; initialState?: State }) {
  const [state, setState] = useState<State>(initialState ?? "loading");
  const [reading, setReading] = useState<Reading | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/environments/${environment}/realtime/log`,
        { cache: "no-store", signal: controller.signal });
      const body: unknown = (await response.json().catch(() => ({}))) ?? {};
      if (controller.signal.aborted) return;
      const payload = body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as { data?: Reading }) : {};
      if (response.status === 200 && payload.data) {
        setReading(payload.data);
        setState("ready");
      } else {
        setReading(null);
        setState("error");
      }
    } catch {
      if (!controller.signal.aborted) { setReading(null); setState("error"); }
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, [projectId, environment]);

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);

  if (state === "loading") {
    return <div className="console-card live-module-state">
      <RefreshCw size={24}/><h3>{t(REALTIME_LOG_STATES.loading)}</h3>
    </div>;
  }

  return <div className="module-grid">
    <article className="console-card span-2">
      <div className="card-head"><div>
        <span>{t(REALTIME_LOG_TEXTS.kicker)} · {environment.toUpperCase()}</span>
        <h3>{t(REALTIME_LOG_TEXTS.title)}</h3>
      </div><div>
        <button className="secondary-button" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw size={14}/> <StableLabel current={refreshing ? t("Lädt…") : t("Neu laden")} variants={tAll("Lädt…", "Neu laden")}/>
        </button>
      </div></div>
      <p className="muted">{t(REALTIME_LOG_TEXTS.scope)}</p>
      {state === "error" && <p className="risk medium">{t(REALTIME_LOG_STATES.unavailable)}</p>}
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div>
        <span>{t("WAS ES NICHT GIBT")}</span><h3>{t(REALTIME_LOG_TEXTS.connectionsTitle)}</h3>
      </div><Unplug size={18}/></div>
      <p className="risk medium">{t(REALTIME_LOG_TEXTS.connectionsNoRecord)}</p>
      <p className="muted">{t(REALTIME_LOG_TEXTS.connectionsWhyNot)}</p>
      <p className="muted">{t(REALTIME_LOG_TEXTS.connectionsNoHistory)}</p>
      <p className="muted">{t(REALTIME_LOG_TEXTS.connectionsWhatInstead)}</p>
    </article>

    {reading && <ChannelsCard reading={reading}/>}
    {reading && <FeedCard reading={reading}/>}
    {reading && <MessagesCard reading={reading}/>}

    <article className="console-card span-2">
      <div className="card-head"><div>
        <span>{t("ABGRENZUNG")}</span><h3>{t(REALTIME_LOG_TEXTS.reportsTitle)}</h3>
      </div><Activity size={18}/></div>
      <p className="muted">{t(REALTIME_LOG_TEXTS.reportsMeaning)}</p>
      <p className="muted">{t(REALTIME_LOG_TEXTS.reportsDifference)}</p>
    </article>

    <article className="console-card span-2">
      <div className="card-head"><div>
        <span>{t("FÜR BETREIBER")}</span><h3>{t(REALTIME_LOG_TEXTS.operatorTitle)}</h3>
      </div><Send size={18}/></div>
      <p className="muted">{t(REALTIME_LOG_TEXTS.operatorSteps)}</p>
      <p className="muted">{t(REALTIME_LOG_TEXTS.operatorDrain)}</p>
    </article>
  </div>;
}

function ChannelsCard({ reading }: { reading: Reading }) {
  const stored = reading.channels.reduce((sum, entry) => sum + entry.stored, 0);
  const assigned = reading.channels.reduce((sum, entry) => sum + entry.assigned, 0);
  return <article className="console-card span-2">
    <div className="card-head"><div>
      <span>{t("WAS ES GIBT")}</span><h3>{t(REALTIME_LOG_TEXTS.channelsTitle)}</h3>
    </div><Radio size={18}/></div>
    <p className="muted">{t(REALTIME_LOG_TEXTS.channelsMeaning)}</p>
    <p className="muted">{t(REALTIME_LOG_TEXTS.channelsRetention)}</p>
    <p className="risk medium">{t(REALTIME_LOG_TEXTS.channelsLimit)}</p>

    <div className="auth-overview">
      <div><span>{t("KANÄLE")}</span><strong>{formatNumber(reading.channels.length)}</strong><small>{t("mit einem Zähler in dieser Umgebung")}</small></div>
      <div><span>{t("IM LOG")}</span><strong>{formatNumber(stored)}</strong><small>{t("Nachrichten, die jetzt noch da sind")}</small></div>
      <div><span>{t("JE VERGEBEN")}</span><strong>{formatNumber(assigned)}</strong><small>{t("Sequenzen, die je ausgegeben wurden")}</small></div>
    </div>

    {reading.channelsTruncated && <p className="risk medium">{t(REALTIME_LOG_STATES.channelsTruncated)}</p>}

    {reading.channels.length === 0
      ? <p className="muted">{t(REALTIME_LOG_STATES.noChannels)}</p>
      : <>
        <div className="log-row log-header">
          {REALTIME_CHANNEL_COLUMNS.map((column) => <span key={column.label} title={t(column.meaning)}>{t(column.label)}</span>)}
        </div>
        {reading.channels.map((entry) => <div className="log-row" key={entry.channel}>
          <code>{entry.channel}</code>
          <span>{formatNumber(entry.stored)}</span>
          <span>{formatNumber(entry.assigned)}</span>
          <span className="muted">{entry.lastCreatedAt === null ? t("nichts mehr im Log") : formatMoment(entry.lastCreatedAt)}</span>
        </div>)}
      </>}
  </article>;
}

function MessagesCard({ reading }: { reading: Reading }) {
  return <article className="console-card span-2">
    <div className="card-head"><div>
      <span>{t("WAS ES GIBT")}</span><h3>{t(REALTIME_LOG_TEXTS.messagesTitle)}</h3>
    </div><Waves size={18}/></div>
    <p className="muted">{t(REALTIME_LOG_TEXTS.messagesMeaning)}</p>
    <p className="muted">{t(REALTIME_LOG_TEXTS.messagesNoPayload)}</p>

    {reading.messagesTruncated && <p className="muted">{t(REALTIME_LOG_STATES.messagesTruncated)}</p>}

    {reading.messages.length === 0
      ? <p className="muted">{t(REALTIME_LOG_STATES.noMessages)}</p>
      : <>
        <div className="log-row log-header">
          {REALTIME_MESSAGE_COLUMNS.map((column) => <span key={column.label} title={t(column.meaning)}>{t(column.label)}</span>)}
        </div>
        {reading.messages.map((entry) => <div className="log-row" key={`${entry.channel}:${entry.sequence}`}>
          <span className="muted">{formatMoment(entry.createdAt)}</span>
          <code>{entry.channel}#{formatNumber(entry.sequence)}</code>
          <span>{entry.event}</span>
          <span>{t(REALTIME_ROLE_LABELS[entry.actorRole])}</span>
          <span className="muted">{formatNumber(entry.payloadBytes)} {t("Bytes")}</span>
        </div>)}
      </>}
    <p className="muted">{t(REALTIME_LOG_TEXTS.messagesLimit)}</p>
  </article>;
}

function FeedCard({ reading }: { reading: Reading }) {
  const { feed, feedState, cursor } = reading;
  return <article className="console-card span-2">
    <div className="card-head"><div>
      <span>{t("WAS IM BETRIEB ZÄHLT")}</span><h3>{t(REALTIME_LOG_TEXTS.feedTitle)}</h3>
    </div><Activity size={18}/></div>
    <p className="muted">{t(REALTIME_LOG_TEXTS.feedMeaning)}</p>
    <p className="muted">{t(REALTIME_LOG_TEXTS.feedCursorMeaning)}</p>
    <p className="risk medium">{t(REALTIME_LOG_TEXTS.feedCursorLimit)}</p>

    {feedState === "disabled" && <p className="muted">{t(REALTIME_LOG_STATES.feedDisabled)}</p>}
    {feedState === "not_ready" && <p className="muted">{t(REALTIME_LOG_STATES.feedNotReady)}</p>}
    {feedState === "unavailable" && <p className="muted">{t(REALTIME_LOG_STATES.feedUnavailable)}</p>}

    {feed !== null && (feed.present
      ? <>
        <div className="auth-overview">
          <div><span>{t("RÜCKSTAND")}</span><strong>{formatNumber(feed.backlog)}</strong><small>{t("Zeilen oberhalb der gelesenen Position")}</small></div>
          <div><span>{t("IM FEED")}</span><strong>{formatNumber(feed.rows)}</strong><small>{t("Zeilen, die der Feed gerade hält")}</small></div>
          <div><span>{t("GELESEN BIS")}</span><strong>{cursor === null ? t("nie") : formatNumber(cursor.position)}</strong><small>{t("Position der Webhook-Brücke")}</small></div>
          <div><span>{t("ERFASSENDE TABELLEN")}</span><strong>{formatNumber(feed.capturedTables)}</strong><small>{t("mit einem Trigger auf capture_change")}</small></div>
        </div>
        {cursor === null && <p className="muted">{t(REALTIME_LOG_STATES.cursorNever)}</p>}
        {feed.capturedTables === 0 && <p className="risk medium">{t(REALTIME_LOG_STATES.feedNoCapture)}</p>}
        <div className="log-row log-header"><span>{t("Einfügen")}</span><span>{t("Ändern")}</span><span>{t("Löschen")}</span><span>{t("Älteste Zeile")}</span></div>
        <div className="log-row">
          <span>{formatNumber(feed.byOperation.insert)}</span>
          <span>{formatNumber(feed.byOperation.update)}</span>
          <span>{formatNumber(feed.byOperation.delete)}</span>
          <span className="muted">{feed.oldestCommittedAt === null ? t("keine Zeile im Feed") : formatMoment(feed.oldestCommittedAt)}</span>
        </div>
        <p className="muted">{t(REALTIME_LOG_TEXTS.feedCaptureMeaning)}</p>
        <p className="muted">{t(REALTIME_LOG_TEXTS.feedNoRowValues)}</p>
      </>
      : <p className="risk medium">{t(REALTIME_LOG_STATES.feedAbsent)}</p>)}
  </article>;
}
