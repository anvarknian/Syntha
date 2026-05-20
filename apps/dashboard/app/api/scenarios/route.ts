import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const apiURL = process.env.SYNTHA_API_URL ?? "http://localhost:8080";
  const response = await fetch(`${apiURL.replace(/\/$/, "")}/scenario`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-yaml",
    },
    body,
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text };
  }

  return NextResponse.json(payload, { status: response.status });
}
