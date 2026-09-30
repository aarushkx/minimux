import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, service: "mini-mux-api" });
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
