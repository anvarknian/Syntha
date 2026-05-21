import { backendURL, proxyJSON } from "@/app/api/backend";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxyJSON(fetch(backendURL("/v1/storage"), { cache: "no-store" }));
}
