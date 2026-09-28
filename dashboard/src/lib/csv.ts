/**
 * Client-side CSV export: the pages already hold the data,
 * so a download needs no API change and works in নমুনা মোড too.
 */

/** RFC 4180-quote one cell (quotes doubled, wrapped when needed). */
function cell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows → CSV text; header is the first row. */
export function toCSV(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

/** toCSV + trigger a browser download with a BOM (Excel-friendly Bangla). */
export function downloadCSV(filename: string, header: string[], rows: unknown[][]) {
  const blob = new Blob(['\uFEFF' + toCSV(header, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // revoking in the same tick can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
