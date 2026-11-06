// Reads recovered PDFs from the QUARANTINE folder (untrusted bytes, never executed or opened by a viewer) through pdf-evidence.mjs.
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { analyzePdfFile } from './pdf-evidence.mjs'

/** Joins an archive-relative path under the quarantine root; returns null for anything that could escape it. */
export function safeJoin(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes('\\') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) return null
  const parts = relative.split('/')
  if (parts.some((p) => p === '..' || p === '.' || p === '')) return null
  const base = path.resolve(root)
  const full = path.resolve(base, ...parts)
  return full.startsWith(base + path.sep) ? full : null
}

/**
 * @param {{ path: string, size: number, sha256: string }[]} rows inventory rows of PDFs
 * @returns {Promise<Map<string, { analysis: object, problems: string[] }>>}
 */
export async function collectPdfEvidence(rows, { root, mode, concurrency = 4, onProgress } = {}) {
  const out = new Map()
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++]
      const problems = []
      let analysis
      const full = safeJoin(root, row.path)
      if (!full) { analysis = { ok: false, reason: 'unsafe_path' } } else {
        const st = await lstat(full).catch(() => null)
        if (!st) analysis = { ok: false, reason: 'file_missing' }
        else if (st.isSymbolicLink() || !st.isFile()) analysis = { ok: false, reason: 'not_a_regular_file' }
        else {
          analysis = await analyzePdfFile(full, { mode })
          if (analysis.size != null && analysis.size !== row.size) problems.push('size_differs_from_inventory')
          if (analysis.ok && analysis.sha256 && analysis.sha256 !== row.sha256) problems.push('sha256_differs_from_inventory')
        }
      }
      out.set(row.path, { analysis, problems })
      onProgress?.(++done, rows.length)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
  return out
}

/** JSON file written by this project's tools; Windows PowerShell may prepend a byte order mark. */
export async function readJsonFile(file) {
  const text = await readFile(file, 'utf8')
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
}
