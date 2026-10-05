export type ReportFile = { name: string; mtimeMs: number; text: string }

export function reportLine(text: string): string | null {
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('REPORT ')) return line.trim()
  }
  return null
}

/** New REPORT lines since the marks; no marks yet means a baseline that sends nothing. */
export function pickReports(
  files: ReportFile[],
  delivered: Record<string, number> | null,
): { lines: string[]; delivered: Record<string, number> } {
  const marks = { ...(delivered ?? {}) }
  const lines: string[] = []
  for (const f of files) {
    if (delivered !== null && f.mtimeMs > (delivered[f.name] ?? 0)) {
      const line = reportLine(f.text)
      if (line) lines.push(line)
    }
    marks[f.name] = Math.max(marks[f.name] ?? 0, f.mtimeMs)
  }
  return { lines, delivered: marks }
}
