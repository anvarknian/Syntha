import { backendURL, proxyJSON } from "@/app/api/backend";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyJSON(fetch(backendURL(`/v1/diffs?${url.searchParams.toString()}`), { cache: "no-store" }));
}

export async function POST(request: Request) {
  const body = await request.text();
  return proxyJSON(
    fetch(backendURL("/v1/diffs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}
