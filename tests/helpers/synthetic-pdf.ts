// Synthetic PDF generator for the recovery tests. The files are inert byte strings built here: no real or recovered content is used.
export type InfoValue = string | Buffer // string = already PDF syntax, e.g. '(Hello)'

export interface SyntheticPdfOptions {
  info?: Record<string, InfoValue>
  extraObjects?: string[] // raw object bodies appended before the trailer
  xmpTitle?: string
  pages?: number
  encrypt?: boolean
  padStreamBytes?: number // bytes of binary stream data (placed before the Info object, so large files exercise the bounded paths)
  infoInObjectStream?: boolean // the trailer points at an Info object that is not present in the file
}

export const literal = (s: string) => `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`
export const hexOf = (b: Buffer) => `<${b.toString('hex')}>`
export const utf16be = (s: string) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(s, 'utf16le').swap16()])

export function syntheticPdf(o: SyntheticPdfOptions = {}): Buffer {
  const parts: (string | Buffer)[] = ['%PDF-1.4\n%\xe2\xe3\xcf\xd3\n']
  const pages = o.pages ?? 3
  const kids = Array.from({ length: pages }, (_, i) => `${10 + i} 0 R`).join(' ')
  parts.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  parts.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n`)
  for (let i = 0; i < pages; i++) parts.push(`${10 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n`)
  if (o.xmpTitle !== undefined) {
    const xmp = `<?xpacket begin="" id="x"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="r" xmlns:dc="d"><rdf:Description><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${o.xmpTitle}</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
    parts.push(`3 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${Buffer.byteLength(xmp)} >>\nstream\n${xmp}\nendstream\nendobj\n`)
  }
  if (o.padStreamBytes) {
    // deterministic bytes that deliberately contain keyword look-alikes: they must never be counted
    const pad = Buffer.alloc(o.padStreamBytes)
    const bait = Buffer.from('/JavaScript /JS (x) /Launch /OpenAction 1 0 R /AA << >> /URI (http://x) /EmbeddedFile ')
    for (let i = 0; i < pad.length; i++) pad[i] = (i * 31 + 7) & 0xff
    for (let i = 0; i + bait.length < pad.length; i += 4096) bait.copy(pad, i)
    parts.push(`4 0 obj\n<< /Length ${pad.length} >>\nstream\n`, pad, '\nendstream\nendobj\n')
  }
  for (const body of o.extraObjects ?? []) parts.push(body)
  const infoEntries = Object.entries(o.info ?? {})
  if (infoEntries.length && !o.infoInObjectStream) {
    parts.push(`5 0 obj\n<< ${infoEntries.map(([k, v]) => `/${k} ${Buffer.isBuffer(v) ? v.toString('latin1') : v}`).join(' ')} >>\nendobj\n`)
  }
  const ref = infoEntries.length ? ' /Info 5 0 R' : ''
  parts.push(`trailer\n<< /Size 20 /Root 1 0 R${ref}${o.encrypt ? ' /Encrypt 6 0 R' : ''} >>\nstartxref\n0\n%%EOF\n`)
  return Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)))
}
