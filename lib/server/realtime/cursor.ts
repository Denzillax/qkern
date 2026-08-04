import { createHmac, timingSafeEqual } from "node:crypto";
import type { RealtimeScope } from "@/lib/server/realtime/model";
import { RealtimeError } from "@/lib/server/realtime/model";

type CursorPayload = {
  v: 1;
  organizationId: string;
  projectId: string;
  environment: string;
  channel: string;
  sequence: number;
};

export class RealtimeCursorCodec {
  private readonly secret: Buffer;

  constructor(secret: Uint8Array) {
    if (secret.byteLength < 32 || secret.byteLength > 256) {
      throw new RealtimeError("REALTIME_CURSOR_INVALID");
    }
    this.secret = Buffer.from(secret);
  }

  encode(scope: RealtimeScope, channel: string, sequence: number): string {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new RealtimeError("REALTIME_CURSOR_INVALID");
    }
    const payload: CursorPayload = { v: 1, ...scope, channel, sequence };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `qk_rt_${encoded}.${this.sign(encoded)}`;
  }

  decode(cursor: string, scope: RealtimeScope, channel: string): number {
    const matched = cursor.match(/^qk_rt_([A-Za-z0-9_-]{20,900})\.([A-Za-z0-9_-]{43})$/);
    if (!matched) throw new RealtimeError("REALTIME_CURSOR_INVALID");
    const [, encoded, suppliedSignature] = matched;
    const expected = Buffer.from(this.sign(encoded));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new RealtimeError("REALTIME_CURSOR_INVALID");
    }
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CursorPayload;
      if (payload.v !== 1 || payload.organizationId !== scope.organizationId ||
          payload.projectId !== scope.projectId || payload.environment !== scope.environment ||
          payload.channel !== channel || !Number.isSafeInteger(payload.sequence) || payload.sequence < 0) {
        throw new Error("invalid");
      }
      return payload.sequence;
    } catch {
      throw new RealtimeError("REALTIME_CURSOR_INVALID");
    }
  }

  presenceKey(scope: RealtimeScope, channel: string, subject: string, connectionId: string): string {
    const material = `${scope.organizationId}\n${scope.projectId}\n${scope.environment}\n${channel}\n${subject}\n${connectionId}`;
    return `qk_presence_${createHmac("sha256", this.secret).update(material, "utf8").digest("base64url").slice(0, 22)}`;
  }

  private sign(encoded: string) {
    return createHmac("sha256", this.secret).update(encoded, "utf8").digest("base64url");
  }
}
