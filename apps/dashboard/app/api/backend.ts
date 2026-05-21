import { NextResponse } from "next/server";

export function backendURL(path: string): string {
  return `${(process.env.SYNTHA_API_URL ?? "http://localhost:8080").replace(/\/$/, "")}${path}`;
}

export async function proxyJSON(request: Promise<Response>): Promise<NextResponse> {
  try {
    const response = await request;
    const payload = await response.json().catch(() => ({ error: { code: "bad_backend_response" } }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "backend_unavailable",
          message: error instanceof Error ? error.message : "Go API is unavailable",
        },
      },
      { status: 502 },
    );
  }
}

