// PDF.js canvas renderer: one page at a time, cancellable, with explicit cleanup. Browser-only (never imported on the server).
// The document is rendered to <canvas>; there is no iframe, object, embed or native viewer, and no download / print / open-original control.
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

export type ZoomMode = 'fit' | number
export type ReaderFailure = 'load' | 'render' | 'encrypted' | 'expired'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
const MAX_PIXELS = 16_000_000 // cap the canvas backing store so huge pages cannot exhaust memory

export function usePdfReader(canvas: Ref<HTMLCanvasElement | null>, viewport: Ref<HTMLElement | null>) {
  const pageCount = ref(0)
  const page = ref(1)
  const zoom = ref<ZoomMode>('fit')
  const loading = ref(false)
  const rendering = ref(false)
  const progress = ref(0)
  const failure = ref<ReaderFailure | null>(null)
  const ready = computed(() => pageCount.value > 0 && !failure.value)

  let fitScale = 1 // the scale that makes the page exactly as wide as the viewport; zoom steps start from what is on screen
  let task: PDFDocumentLoadingTask | null = null
  let doc: PDFDocumentProxy | null = null
  let current: PDFPageProxy | null = null
  let render: RenderTask | null = null
  let ticket = 0 // a later request supersedes an earlier one even if its promise still resolves
  let disposed = false

  function cancelRender() {
    try { render?.cancel() } catch { /* already finished */ }
    render = null
  }

  async function open(url: string, startPage = 1) {
    await close()
    disposed = false
    failure.value = null; loading.value = true; progress.value = 0
    try {
      const pdfjs = await import('pdfjs-dist')
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = worker
      const base = `/_pdfjs/${pdfjs.version}` // folder written by scripts/copy-pdfjs-assets.mjs from the same pinned package
      task = pdfjs.getDocument({
        url, withCredentials: false, isEvalSupported: false, enableXfa: false, stopAtErrors: false,
        cMapUrl: `${base}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}/standard_fonts/`, wasmUrl: `${base}/wasm/`,
      })
      task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => { if (total > 0) progress.value = Math.min(1, loaded / total) }
      doc = await task.promise
      if (disposed) { await close(); return }
      pageCount.value = doc.numPages
      loading.value = false
      await go(startPage)
    } catch (e) {
      loading.value = false
      const name = (e as { name?: string })?.name ?? ''
      const status = (e as { status?: number })?.status
      failure.value = name === 'PasswordException' ? 'encrypted' : status === 403 || status === 401 ? 'expired' : 'load'
    }
  }

  async function draw() {
    const el = canvas.value
    if (!doc || !el) return
    const mine = ++ticket
    cancelRender()
    rendering.value = true
    try {
      current?.cleanup()
      const p = await doc.getPage(page.value)
      if (mine !== ticket) return
      current = p
      const natural = p.getViewport({ scale: 1 })
      const box = viewport.value
      const pad = box ? (parseFloat(getComputedStyle(box).paddingLeft) || 0) + (parseFloat(getComputedStyle(box).paddingRight) || 0) : 0
      const width = box ? box.clientWidth - pad : natural.width
      fitScale = Math.max(0.1, width / natural.width)
      const scale = zoom.value === 'fit' ? fitScale : zoom.value
      const css = p.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const k = Math.min(dpr, Math.sqrt(MAX_PIXELS / (css.width * css.height)))
      el.width = Math.floor(css.width * k); el.height = Math.floor(css.height * k)
      el.style.width = `${Math.floor(css.width)}px`; el.style.height = `${Math.floor(css.height)}px`
      const ctx = el.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      render = p.render({ canvasContext: ctx, canvas: el, viewport: p.getViewport({ scale: scale * k }) })
      await render.promise
    } catch (e) {
      if ((e as { name?: string })?.name === 'RenderingCancelledException') return
      if (mine === ticket) failure.value = 'render'
    } finally {
      if (mine === ticket) rendering.value = false
    }
  }

  async function go(n: number) {
    if (!doc) return
    page.value = Math.min(Math.max(1, Math.round(n) || 1), pageCount.value)
    await draw()
  }
  const next = () => go(page.value + 1)
  const prev = () => go(page.value - 1)
  function setZoom(z: ZoomMode) { zoom.value = z === 'fit' ? 'fit' : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)); return draw() }
  const zoomIn = () => setZoom((zoom.value === 'fit' ? fitScale : zoom.value) * 1.2)
  const zoomOut = () => setZoom((zoom.value === 'fit' ? fitScale : zoom.value) / 1.2)

  async function close() {
    disposed = true; ticket++
    cancelRender()
    try { current?.cleanup() } catch { /* ignore */ }
    current = null
    const t = task; const d = doc
    task = null; doc = null
    pageCount.value = 0
    try { await d?.destroy() } catch { /* ignore */ }
    try { await t?.destroy() } catch { /* ignore */ }
    const el = canvas.value
    if (el) { el.width = 0; el.height = 0 } // release the backing store
  }

  // refit when the container changes size (rotation, window resize, fullscreen)
  let ro: ResizeObserver | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  // the viewport element only exists while the reader is on screen (v-if), so observe whichever element is current
  watch(viewport, (el) => {
    ro?.disconnect(); ro = null
    if (!el || typeof ResizeObserver === 'undefined') return
    ro = new ResizeObserver(() => { if (zoom.value !== 'fit' || !doc) return; clearTimeout(timer); timer = setTimeout(() => void draw(), 120) })
    ro.observe(el)
  }, { flush: 'post' })
  onBeforeUnmount(() => { clearTimeout(timer); ro?.disconnect(); void close() })

  return { pageCount, page, zoom, loading, rendering, progress, failure, ready, open, close, go, next, prev, setZoom, zoomIn, zoomOut, ZOOM_MIN, ZOOM_MAX }
}
