import { NextResponse } from "next/server";
import { qkernOpenAPI } from "@/lib/openapi";

export function GET() {
  return NextResponse.json(qkernOpenAPI, { headers: { "Cache-Control": "public, max-age=300" } });
}
