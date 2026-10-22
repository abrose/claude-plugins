export type ReportFile = { name: string; mtimeMs: number; text: string }

/** The contents of `delivered.json`: a number per agent and `_decision`, and `_line:<name>` holds the last REPORT line sent. */
export type Marks = Record<string, number | string>

const LINE_KEY = '_line:'

export function reportLine(text: string): string | null {
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('REPORT ')) return line.trim()
  }
  return null
}

/** A numeric mark; a missing key or a text mark counts as 0. */
export function numberMark(marks: Marks | null, key: string): number {
  const mark = marks?.[key]
  return typeof mark === 'number' ? mark : 0
}

/** The marks to write: what is on disk now, with each incoming mark on top. A number never goes down. */
export function mergeMarks(disk: Marks | null, incoming: Marks): Marks {
  const merged: Marks = { ...(disk ?? {}) }
  for (const [key, mark] of Object.entries(incoming)) {
    const now = merged[key]
    merged[key] = typeof mark === 'number' && typeof now === 'number' ? Math.max(now, mark) : mark
  }
  return merged
}

/**
 * New REPORT lines since the marks; no marks yet means a baseline that sends nothing.
 * A file newer than its mark whose line equals the last line sent for that agent is marked, not sent.
 */
export function pickReports(
  files: ReportFile[],
  delivered: Marks | null,
): { lines: string[]; delivered: Marks } {
  const marks: Marks = { ...(delivered ?? {}) }
  const lines: string[] = []
  for (const f of files) {
    if (delivered !== null && f.mtimeMs > numberMark(delivered, f.name)) {
      const line = reportLine(f.text)
      if (line && line !== delivered[LINE_KEY + f.name]) {
        lines.push(line)
        marks[LINE_KEY + f.name] = line
      }
    }
    marks[f.name] = Math.max(numberMark(marks, f.name), f.mtimeMs)
  }
  return { lines, delivered: marks }
}
