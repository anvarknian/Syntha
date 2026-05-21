import { backendURL, proxyJSON } from "@/app/api/backend";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  return proxyJSON(
    fetch(backendURL("/v1/storage/retention"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  );
}
