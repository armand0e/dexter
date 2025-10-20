"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  DexterEvent,
  DexterLogEntry,
  DexterTask,
  ProgressState,
  ProgressStatus,
} from "@/types/dexter"

// Use same-origin Next.js API routes which proxy to the backend container.

type RunState = "idle" | "running" | "done" | "error"

function useDexterLogs() {
  const [logs, setLogs] = useState<DexterLogEntry[]>([])

  const pushLog = useCallback((entry: Omit<DexterLogEntry, "id">) => {
    setLogs((prev) => [
      {
        id: crypto.randomUUID(),
        ...entry,
      },
      ...prev,
    ])
  }, [])

  const reset = useCallback(() => setLogs([]), [])

  return { logs, pushLog, reset }
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

const PROGRESS_STATUSES: readonly ProgressStatus[] = ["start", "complete", "error"]

type RawEvent = {
  type: string
  [key: string]: unknown
}

function normalizeTasks(rawTasks: unknown): DexterTask[] {
  if (!Array.isArray(rawTasks)) return []

  return rawTasks.map((rawTask, index) => {
    if (typeof rawTask === "object" && rawTask !== null) {
      const candidate = rawTask as Partial<DexterTask>
      const id = typeof candidate.id === "number" ? candidate.id : index + 1
      const description =
        typeof candidate.description === "string"
          ? candidate.description
          : `Task ${index + 1}`
      const done = typeof candidate.done === "boolean" ? candidate.done : Boolean(candidate.done)
      return { id, description, done }
    }

    return {
      id: index + 1,
      description: `Task ${index + 1}`,
      done: false,
    }
  })
}

function coerceDexterEvent(payload: unknown): DexterEvent | null {
  if (!payload || typeof payload !== "object") return null
  const raw = payload as RawEvent
  if (typeof raw.type !== "string") return null

  switch (raw.type) {
    case "task_list": {
      const tasks = normalizeTasks(raw.tasks)
      return { type: "task_list", tasks }
    }
    case "task_start": {
      const task = typeof raw.task === "string" ? raw.task : ""
      return task ? { type: "task_start", task } : null
    }
    case "task_done": {
      const task = typeof raw.task === "string" ? raw.task : ""
      return task ? { type: "task_done", task } : null
    }
    case "progress": {
      const statusRaw = typeof raw.status === "string" ? raw.status : "start"
      const status = PROGRESS_STATUSES.includes(statusRaw as ProgressStatus)
        ? (statusRaw as ProgressStatus)
        : "start"
      const message = typeof raw.message === "string" ? raw.message : ""
      return { type: "progress", status, message }
    }
    case "tool_run": {
      const tool = typeof raw.tool === "string" ? raw.tool : ""
      return tool ? { type: "tool_run", tool, result: raw.result } : null
    }
    case "warning": {
      const message = typeof raw.message === "string" ? raw.message : ""
      if (!message) return null
      const tool = typeof raw.tool === "string" ? raw.tool : undefined
      const input = typeof raw.input === "string" ? raw.input : undefined
      return { type: "warning", message, tool, input }
    }
    case "log": {
      const message = typeof raw.message === "string" ? raw.message : ""
      return { type: "log", message }
    }
    case "header": {
      const message = typeof raw.message === "string" ? raw.message : ""
      return { type: "header", message }
    }
    case "user_query": {
      const query = typeof raw.query === "string" ? raw.query : ""
      return { type: "user_query", query }
    }
    case "answer": {
      const answer = typeof raw.answer === "string" ? raw.answer : ""
      return { type: "answer", answer }
    }
    case "done": {
      const answer = typeof raw.answer === "string" ? raw.answer : undefined
      return { type: "done", answer }
    }
    case "error": {
      const message = typeof raw.message === "string" ? raw.message : ""
      return message ? { type: "error", message } : null
    }
    default:
      return null
  }
}

function useDexterRun() {
  const [runState, setRunState] = useState<RunState>("idle")
  const [runId, setRunId] = useState<string>()
  const [tasks, setTasks] = useState<DexterTask[]>([])
  const [answer, setAnswer] = useState<string>("")
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [error, setError] = useState<string>("")
  const { logs, pushLog, reset } = useDexterLogs()
  const eventSourceRef = useRef<EventSource | null>(null)
  const finishedRef = useRef<boolean>(false)

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
  }, [])

  const handleEvent = useCallback(
    (event: DexterEvent) => {
      const timestamp = formatTime(new Date())

      switch (event.type) {
        case "task_list":
          setTasks(event.tasks)
          pushLog({
            kind: "info",
            title: "Tasks planned",
            body: `${event.tasks.length} task(s) created`,
            timestamp,
          })
          break
        case "task_start":
          pushLog({
            kind: "info",
            title: "Task started",
            body: event.task,
            timestamp,
          })
          break
        case "task_done":
          setTasks((prev) =>
            prev.map((task) =>
              task.description === event.task ? { ...task, done: true } : task
            )
          )
          pushLog({
            kind: "info",
            title: "Task completed",
            body: event.task,
            timestamp,
          })
          break
        case "progress":
          setProgress({
            status: event.status,
            message: event.message,
            timestamp,
          })
          pushLog({
            kind: "progress",
            title: event.status === "start" ? "Working" : "Progress",
            body: event.message,
            timestamp,
          })
          break
        case "tool_run": {
          const resultText =
            typeof event.result === "string"
              ? event.result
              : event.result != null
              ? JSON.stringify(event.result, null, 2)
              : undefined
          pushLog({
            kind: "tool",
            title: `Tool: ${event.tool}`,
            body: resultText,
            timestamp,
          })
          break
        }
          break
        case "warning":
          pushLog({
            kind: "warning",
            title: "Warning",
            body: event.message,
            timestamp,
          })
          break
        case "user_query":
          pushLog({
            kind: "info",
            title: "Query",
            body: event.query,
            timestamp,
          })
          break
        case "answer":
          setAnswer(event.answer)
          pushLog({
            kind: "info",
            title: "Answer",
            body: event.answer,
            timestamp,
          })
          break
        case "done":
          if (typeof event.answer === "string" && event.answer) {
            setAnswer(event.answer)
          }
          finishedRef.current = true
          setRunState("done")
          pushLog({
            kind: "info",
            title: "Run complete",
            timestamp,
          })
          closeStream()
          break
        case "error":
          finishedRef.current = true
          setError(event.message)
          setRunState("error")
          pushLog({
            kind: "error",
            title: "Run failed",
            body: event.message,
            timestamp,
          })
          closeStream()
          break
        default:
          pushLog({
            kind: "info",
            title: event.type,
            body: JSON.stringify(event, null, 2),
            timestamp,
          })
      }
    },
    [closeStream, pushLog]
  )

  const startRun = useCallback(
    async (query: string, opts?: { maxSteps?: number; maxStepsPerTask?: number }) => {
      closeStream()
      reset()
      setAnswer("")
      setProgress(null)
      setError("")
      setTasks([])
      setRunState("running")

      try {
        const response = await fetch(`/api/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            max_steps: opts?.maxSteps,
            max_steps_per_task: opts?.maxStepsPerTask,
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to start run (${response.status})`)
        }

        const { run_id } = (await response.json()) as { run_id: string }
        setRunId(run_id)

        const stream = new EventSource(`/api/run/${run_id}/events`)
        eventSourceRef.current = stream

        stream.onmessage = (event) => {
          try {
            const parsed = coerceDexterEvent(JSON.parse(event.data))
            if (parsed) {
              handleEvent(parsed)
            }
          } catch (err) {
            console.error("Failed to parse event", err)
          }
        }

        stream.onerror = (ev) => {
          console.error("EventSource error", ev)
          if (finishedRef.current) {
            // Stream ended after completion; do not surface as an error.
            closeStream()
            return
          }
          setError("Lost connection to Dexter.")
          setRunState("error")
          closeStream()
        }
      } catch (err) {
        console.error(err)
        setRunState("error")
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [closeStream, reset, handleEvent]
  )

  useEffect(() => () => closeStream(), [closeStream])

  return {
    runState,
    runId,
    tasks,
    answer,
    progress,
    error,
    logs,
    startRun,
  }
}

function QueryForm({ onRun, disabled }: { onRun: (query: string) => void; disabled: boolean }) {
  const [query, setQuery] = useState("")
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!query.trim()) return
      onRun(query.trim())
    },
    [onRun, query]
  )

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="dexter-query">Ask Dexter</Label>
        <Input
          id="dexter-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. Compare Microsoft&apos;s revenue growth vs Apple"
          disabled={disabled}
          required
        />
      </div>
      <Button type="submit" disabled={disabled}>
        {disabled ? "Running..." : "Run analysis"}
      </Button>
    </form>
  )
}

function TasksPanel({ tasks }: { tasks: DexterTask[] }) {
  if (!tasks.length) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">Dexter will outline tasks after you run a query.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/40"
        >
          <span className="text-sm font-medium">{task.description}</span>
          {task.done ? (
            <Badge variant="secondary">Done</Badge>
          ) : (
            <Badge variant="outline">In progress</Badge>
          )}
        </div>
      ))}
    </div>
  )
}

function ProgressBanner({ progress }: { progress: ProgressState | null }) {
  if (!progress) return null

  return (
    <Alert>
      <AlertTitle>{progress.status === "start" ? "Agent working" : "Progress"}</AlertTitle>
      <AlertDescription>{progress.message}</AlertDescription>
    </Alert>
  )
}

function AnswerCard({ answer }: { answer: string }) {
  if (!answer) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Answer</CardTitle>
          <CardDescription>Run a query to see Dexter&apos;s synthesis.</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Answer</CardTitle>
        <CardDescription>Dexter&apos;s final response.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
          {answer}
        </div>
      </CardContent>
    </Card>
  )
}

function LogsPanel({ logs }: { logs: DexterLogEntry[] }) {
  if (!logs.length) {
    return (
      <div className="text-sm text-muted-foreground">
        Dexter will stream tool calls, warnings, and info logs here.
      </div>
    )
  }

  return (
    <ScrollArea className="h-[420px] pr-4">
      <div className="flex flex-col gap-4">
        {logs.map((log) => (
          <div key={log.id} className="flex flex-col gap-1 rounded-lg border p-4 bg-card">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{log.title}</span>
              <span className="text-xs text-muted-foreground">{log.timestamp}</span>
            </div>
            {log.body ? (
              <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                {log.body}
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

export default function Home() {
  const { runState, tasks, answer, progress, error, logs, startRun } = useDexterRun()

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:flex-row">
        <div className="flex w-full flex-col gap-6 lg:w-[360px]">
          <Card>
            <CardHeader>
              <CardTitle>Dexter Agent</CardTitle>
              <CardDescription>
                Ask complex financial questions to plan tasks, run tools, and synthesize
                an answer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <QueryForm onRun={(query) => startRun(query)} disabled={runState === "running"} />
            </CardContent>
            <CardFooter className="flex flex-col gap-3 items-start">
              <Badge variant={runState === "running" ? "default" : "outline"}>
                {runState === "running" ? "Running" : runState === "done" ? "Completed" : "Idle"}
              </Badge>
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Run failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Task plan</CardTitle>
              <CardDescription>Dexter updates task status as it works.</CardDescription>
            </CardHeader>
            <CardContent>
              <TasksPanel tasks={tasks} />
            </CardContent>
          </Card>

          <ProgressBanner progress={progress} />
        </div>

        <div className="flex w-full flex-1 flex-col gap-6">
          <AnswerCard answer={answer} />
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Activity log</CardTitle>
              <CardDescription>
                Tool invocations, warnings, and intermediate updates stream in real time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LogsPanel logs={logs} />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
