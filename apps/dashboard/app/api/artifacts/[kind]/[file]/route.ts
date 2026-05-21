import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { resolveReplayArtifact, type ReplayArtifactKind } from "@/lib/replay";

export const dynamic = "force-dynamic";

type ArtifactParams = {
  kind: string;
  file: string;
};

function isReplayArtifactKind(kind: string): kind is ReplayArtifactKind {
  return kind === "screenshot" || kind === "dom";
}

function decodeFileParam(file: string): string | null {
  try {
    return decodeURIComponent(file);
  } catch {
    return null;
  }
}

export async function GET(_request: Request, context: { params: Promise<ArtifactParams> }) {
  const { kind, file } = await context.params;
  if (!isReplayArtifactKind(kind)) {
    return NextResponse.json({ error: "unsupported artifact kind" }, { status: 400 });
  }

  const fileName = decodeFileParam(file);
  if (!fileName) {
    return NextResponse.json({ error: "invalid artifact filename" }, { status: 400 });
  }

  const artifact = resolveReplayArtifact(kind, fileName);
  if (!artifact) {
    return NextResponse.json({ error: "artifact not found" }, { status: 404 });
  }

  const body = await readFile(artifact.path);
  return new NextResponse(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${artifact.fileName}"`,
      "Content-Type": artifact.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
