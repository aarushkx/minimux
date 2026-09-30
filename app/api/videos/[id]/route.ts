import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { videos } from "@/lib/schema";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDb();
  const [video] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  if (!video) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  return NextResponse.json(video);
}
