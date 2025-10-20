import { NextRequest } from "next/server"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const backend = process.env.BACKEND_URL || "http://localhost:8000"
  const url = `${backend}/api/run`

  const body = await req.text()
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    cache: "no-store",
  })

  const data = await res.text()
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  })
}
