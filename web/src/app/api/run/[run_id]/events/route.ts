import type { NextRequest } from "next/server"

export const runtime = "nodejs"

export async function GET(_req: NextRequest, context: { params: { run_id: string } }) {
  const { run_id } = context.params
  const backend = process.env.BACKEND_URL || "http://localhost:8000"
  const url = `${backend}/api/run/${encodeURIComponent(run_id)}/events`

  const controller = new AbortController()
  const upstream = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
    },
    signal: controller.signal,
    cache: "no-store",
  })

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream error: ${upstream.statusText}`, { status: upstream.status })
  }

  const stream = new ReadableStream({
    start(controller2) {
      const reader = upstream.body!.getReader()
      const pump = (): any =>
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              controller2.close()
              return
            }
            if (value) controller2.enqueue(value)
            return pump()
          })
          .catch((err) => controller2.error(err))
      return pump()
    },
    cancel() {
      controller.abort()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
