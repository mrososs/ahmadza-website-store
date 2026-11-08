<script setup lang="ts">
// Reusable in-browser reader. The server decides who may read (GET /api/reader/:id); the PDF is drawn on a canvas by PDF.js.
// No download, print, open-original or new-tab control is offered, and no storage location is ever shown in the UI.
import { PURCHASE_BUTTON_LABEL, PURCHASE_REQUIRED_MESSAGE } from '~~/shared/utils/readerAccess'

const props = defineProps<{ bookId: number; title?: string }>()

type View = 'loading' | 'reading' | 'purchase' | 'unavailable' | 'error'
const view = ref<View>('loading')
const root = ref<HTMLElement | null>(null)
const viewportEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const reader = usePdfReader(canvasEl, viewportEl)
const { page, pageCount, zoom, progress, loading, rendering, failure } = reader
const jump = ref('1')
const fullscreen = ref(false)
const storeKey = computed(() => `aw_reader_page_${props.bookId}`) // per-viewer convenience only; never an entitlement

function savedPage() {
  try { return Math.max(1, Number(localStorage.getItem(storeKey.value)) || 1) } catch { return 1 }
}
function remember() { try { localStorage.setItem(storeKey.value, String(page.value)) } catch { /* private mode */ } }

async function start() {
  view.value = 'loading'
  try {
    const res = await $fetch<{ state: 'granted'; source: string; title: string }>(`/api/reader/${props.bookId}`, { headers: { accept: 'application/json' } })
    view.value = 'reading'
    await nextTick()
    await reader.open(res.source, savedPage())
  } catch (e) {
    const err = e as { statusCode?: number; data?: { data?: { state?: string } } }
    const state = err.data?.data?.state
    view.value = state === 'purchase_required' || err.statusCode === 401 || err.statusCode === 403 ? 'purchase' : state === 'unavailable' || err.statusCode === 503 ? 'unavailable' : 'error'
  }
}
// a refused/expired delivery or a failed render is retried with a brand-new server decision, from the same page
async function retry() { await start() }

watch(page, (p) => { jump.value = String(p); if (view.value === 'reading') remember() })
watch(failure, (f) => { if (f) view.value = f === 'load' || f === 'render' || f === 'expired' || f === 'encrypted' ? 'error' : view.value })

function submitJump() { void reader.go(Number(jump.value)); jump.value = String(page.value) }
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await root.value?.requestFullscreen()
  } catch { /* not supported / refused */ }
}
function onKey(e: KeyboardEvent) {
  if (view.value !== 'reading' || (e.target as HTMLElement)?.tagName === 'INPUT') return
  // Arabic books turn right-to-left: the left arrow moves forward
  const map: Record<string, () => unknown> = {
    ArrowLeft: reader.next, PageDown: reader.next, ' ': reader.next, ArrowRight: reader.prev, PageUp: reader.prev,
    Home: () => reader.go(1), End: () => reader.go(pageCount.value), '+': reader.zoomIn, '=': reader.zoomIn, '-': reader.zoomOut, '0': () => reader.setZoom('fit'), f: toggleFullscreen, F: toggleFullscreen,
  }
  const fn = map[e.key]
  if (fn && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); void fn() }
}
function onFs() { fullscreen.value = !!document.fullscreenElement }
onMounted(() => { void start(); document.addEventListener('keydown', onKey); document.addEventListener('fullscreenchange', onFs) })
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs) })

const pct = computed(() => (zoom.value === 'fit' ? 'ملاءمة العرض' : `${Math.round(zoom.value * 100)}%`))
const errorText = computed(() => failure.value === 'encrypted' ? 'هذا الملف محمي ولا يمكن عرضه.' : failure.value === 'expired' ? 'انتهت صلاحية الجلسة. أعد المحاولة.' : 'تعذر تحميل الكتاب. تحقق من اتصالك ثم أعد المحاولة.')
</script>

<template>
  <section ref="root" class="bpr" :class="{ 'bpr--fs': fullscreen }" dir="rtl" role="region" :aria-label="title ? `قارئ الكتاب: ${title}` : 'قارئ الكتاب'">
    <div v-if="view === 'reading'" class="bpr__bar" role="toolbar" aria-label="أدوات القراءة">
      <button type="button" class="bpr__btn" :disabled="page <= 1" aria-label="الصفحة السابقة" @click="reader.prev()"><i class="fa fa-chevron-right" aria-hidden="true" /></button>
      <form class="bpr__jump" @submit.prevent="submitJump">
        <label class="sr-only" for="bpr-page">رقم الصفحة</label>
        <input id="bpr-page" v-model="jump" inputmode="numeric" pattern="[0-9]*" class="bpr__input" :disabled="!pageCount">
        <span aria-live="polite" class="bpr__count">من {{ pageCount || '…' }}</span>
      </form>
      <button type="button" class="bpr__btn" :disabled="page >= pageCount" aria-label="الصفحة التالية" @click="reader.next()"><i class="fa fa-chevron-left" aria-hidden="true" /></button>
      <span class="bpr__sep" aria-hidden="true" />
      <button type="button" class="bpr__btn" aria-label="تصغير" @click="reader.zoomOut()"><i class="fa fa-search-minus" aria-hidden="true" /></button>
      <span class="bpr__zoom" aria-live="polite">{{ pct }}</span>
      <button type="button" class="bpr__btn" aria-label="تكبير" @click="reader.zoomIn()"><i class="fa fa-search-plus" aria-hidden="true" /></button>
      <button type="button" class="bpr__btn bpr__btn--text" :aria-pressed="zoom === 'fit'" @click="reader.setZoom('fit')">ملاءمة العرض</button>
      <button type="button" class="bpr__btn" :aria-label="fullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'" @click="toggleFullscreen"><i class="fa" :class="fullscreen ? 'fa-compress' : 'fa-expand'" aria-hidden="true" /></button>
    </div>

    <div v-if="view === 'reading'" ref="viewportEl" class="bpr__view" tabindex="0" aria-label="صفحة الكتاب" @contextmenu.prevent>
      <div v-if="loading" class="bpr__status" role="status"><i class="fa fa-spinner fa-spin" aria-hidden="true" /> جاري تحميل الكتاب… <span v-if="progress > 0">{{ Math.round(progress * 100) }}%</span></div>
      <canvas v-show="pageCount" ref="canvasEl" class="bpr__canvas" role="img" :aria-label="`صفحة ${page} من ${pageCount}`" />
      <div v-if="rendering && pageCount" class="bpr__busy" aria-hidden="true" />
    </div>

    <div v-else-if="view === 'loading'" class="bpr__status bpr__status--box" role="status"><i class="fa fa-spinner fa-spin" aria-hidden="true" /> جاري التحقق من صلاحية القراءة…</div>

    <div v-else-if="view === 'purchase'" class="bpr__modal" role="alertdialog" aria-labelledby="bpr-buy-t" aria-describedby="bpr-buy-d">
      <h2 id="bpr-buy-t" class="sr-only">القراءة تتطلب الشراء</h2>
      <p id="bpr-buy-d" class="bpr__msg">{{ PURCHASE_REQUIRED_MESSAGE }}</p>
      <NuxtLink class="bpr__cta" :to="`/product/${bookId}`">{{ PURCHASE_BUTTON_LABEL }}</NuxtLink>
    </div>

    <div v-else-if="view === 'unavailable'" class="bpr__modal" role="status">
      <p class="bpr__msg">ملف هذا الكتاب قيد التجهيز وسيكون متاحًا للقراءة قريبًا.</p>
    </div>

    <div v-else class="bpr__modal" role="alert">
      <p class="bpr__msg">{{ errorText }}</p>
      <button type="button" class="bpr__cta" @click="retry">إعادة المحاولة</button>
    </div>
  </section>
</template>

<style scoped>
.bpr { display: flex; flex-direction: column; min-height: 70vh; background: #1f2328; color: #f4f1ea; border-radius: 10px; overflow: hidden; }
.bpr--fs { border-radius: 0; height: 100vh; }
.bpr__bar { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; padding: .5rem .75rem; background: #14171a; border-bottom: 1px solid #343a40; }
.bpr__btn { min-width: 40px; min-height: 40px; padding: 0 .6rem; border: 1px solid #3d444b; border-radius: 8px; background: #262b30; color: inherit; cursor: pointer; font: inherit; }
.bpr__btn:hover:not(:disabled) { background: #30363d; }
.bpr__btn:focus-visible, .bpr__input:focus-visible, .bpr__view:focus-visible, .bpr__cta:focus-visible { outline: 3px solid #e0b252; outline-offset: 2px; }
.bpr__btn:disabled { opacity: .4; cursor: not-allowed; }
.bpr__btn--text { font-size: .85rem; }
.bpr__btn[aria-pressed='true'] { border-color: #e0b252; }
.bpr__jump { display: inline-flex; align-items: center; gap: .4rem; margin: 0; }
.bpr__input { width: 4rem; min-height: 40px; text-align: center; border: 1px solid #3d444b; border-radius: 8px; background: #0f1215; color: inherit; font: inherit; }
.bpr__count, .bpr__zoom { font-size: .9rem; min-width: 4.5rem; text-align: center; }
.bpr__sep { flex: 1 1 0; }
.bpr__view { position: relative; flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 1rem; background: #2b3036; -webkit-user-select: none; user-select: none; }
.bpr__canvas { display: block; background: #fff; box-shadow: 0 4px 18px rgba(0, 0, 0, .5); max-width: none; }
.bpr__busy { position: absolute; inset: 0; pointer-events: none; }
.bpr__status { position: absolute; top: 40%; inset-inline: 0; text-align: center; }
.bpr__status--box { position: static; padding: 4rem 1rem; }
.bpr__modal { margin: auto; max-width: 30rem; padding: 2.5rem 1.5rem; text-align: center; }
.bpr__msg { font-size: 1.15rem; line-height: 1.9; margin-bottom: 1.25rem; }
.bpr__cta { display: inline-block; min-height: 44px; padding: .65rem 1.6rem; border: 0; border-radius: 8px; background: #e0b252; color: #1a1304; font-weight: 700; text-decoration: none; cursor: pointer; font: inherit; font-weight: 700; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 575px) { .bpr__btn--text { display: none; } .bpr__view { padding: .25rem; } }
@media (prefers-reduced-motion: reduce) { .fa-spin { animation: none; } }
</style>
