export type DexterTask = {
  id: number
  description: string
  done: boolean
}

export type ProgressStatus = "start" | "complete" | "error"

export const DEXTER_EVENT_TYPES = [
  "task_list",
  "task_start",
  "task_done",
  "progress",
  "tool_run",
  "warning",
  "log",
  "header",
  "user_query",
  "answer",
  "done",
  "error",
] as const

export type DexterEvent =
  | { type: "task_list"; tasks: DexterTask[] }
  | { type: "task_start"; task: string }
  | { type: "task_done"; task: string }
  | { type: "progress"; status: ProgressStatus; message: string }
  | { type: "tool_run"; tool: string; result?: unknown }
  | { type: "warning"; message: string; tool?: string; input?: string }
  | { type: "log"; message: string }
  | { type: "header"; message: string }
  | { type: "user_query"; query: string }
  | { type: "answer"; answer: string }
  | { type: "done"; answer?: string }
  | { type: "error"; message: string }

export type LogKind = "info" | "tool" | "warning" | "progress" | "error"

export type DexterLogEntry = {
  id: string
  kind: LogKind
  title: string
  body?: string
  timestamp: string
}

export type ProgressState = {
  status: ProgressStatus
  message: string
  timestamp: string
}
