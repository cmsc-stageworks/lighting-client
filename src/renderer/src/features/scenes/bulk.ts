/** Parse bulk text like "1-5=255, 10=128, 12" (value defaults to 255). */
export function parseBulk(text: string): { channel: number; value: number }[] {
  const out: { channel: number; value: number }[] = []
  for (const part of text.split(/[,\n;]+/)) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?(?:\s*[=:@]\s*(\d+))?$/)
    if (!m) continue
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    const v = m[3] ? Math.min(255, Math.max(0, Number(m[3]))) : 255
    for (let c = Math.min(a, b); c <= Math.max(a, b); c++) out.push({ channel: c, value: v })
  }
  return out
}
