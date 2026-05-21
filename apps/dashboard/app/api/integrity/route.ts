import { backendURL, proxyJSON } from "@/app/api/backend";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyJSON(fetch(backendURL(`/v1/integrity?${url.searchParams.toString()}`), { cache: "no-store" }));
}
