import { NextResponse } from "next/server";
import { listReplayFiles, readReplaySummary } from "@/lib/replay";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file") ?? undefined;
  return NextResponse.json({
    files: listReplayFiles(),
    summary: readReplaySummary(file),
  });
}
