import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ service: "qkern-control-plane", status: "ok", timestamp: new Date().toISOString() });
}
