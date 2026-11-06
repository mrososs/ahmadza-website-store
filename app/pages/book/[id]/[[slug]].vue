<script setup lang="ts">
// Port of resources/views/front/show-product.blade.php. Everything personalised (access state, comments, favourite)
// is resolved client-side so the SSR/SWR-cached HTML stays identical for all visitors.
import { getBook, relatedBooks } from '~~/shared/queries/catalog'
import { bookComments, type BookCommentRow } from '~~/shared/queries/storefront'
import { MAKER_KIND_LABEL } from '~~/shared/constants'
import type { Database } from '~~/shared/types/database.types'

const client = useSupabaseClient<Database>()
const route = useRoute()
const id = Number(route.params.id)
if (!Number.isInteger(id) || id < 1) throw createError({ statusCode: 404, statusMessage: 'هذه الصفحة غير موجودة', fatal: true })

const { publicUrl } = useMediaUrl()
const cart = useCartStore()
const { info, mounted } = useSessionInfo()

useHead({
  link: [{ rel: 'stylesheet', href: '/assets/css/player.css' }],
  style: [{ innerHTML: ".note_comment{font-size:12px;color:#2f2f2f;font-family:'Cairo-Medium'}.col-lg-9 .wp_h3{color:#111}" }],
})

const { data: book } = await useAsyncData(`book:${id}`, () => getBook(client, id))
if (!book.value) throw createError({ statusCode: 404, statusMessage: 'هذه الصفحة غير موجودة', fatal: true })
const { data: related } = await useAsyncData(`book-related:${id}`, () => relatedBooks(client, id, 4))

const b = computed(() => book.value!)
const categories = computed(() => b.value.book_categories.map((x) => x.categories).filter(Boolean))
const makers = computed(() => (['author', 'reader', 'writer'] as const).map((role) => ({
  role, list: b.value.book_makers.filter((m) => m.role === role).map((m) => m.makers).filter(Boolean),
})).filter((g) => g.list.length))
const media = computed(() => [...b.value.book_media].sort((x, y) => x.sort_order - y.sort_order))
const files = (vis: 'preview' | 'after_purchase', kind: 'file' | 'audio') => media.value.filter((m) => m.visibility === vis && m.kind === kind)
const canBuy = computed(() => b.value.kind === 'paid' && b.value.status === 'published')
const fileExt = computed(() => media.value.find((m) => m.kind === 'file')?.extension ?? 'pdf')

// ---- personalised, client-only state -------------------------------------------------------------
const owned = ref(false)
watch([mounted, () => info.value?.id], async ([m, uid]) => {
  owned.value = m && uid ? (await client.rpc('owns_book', { p_book: id })).data === true : false
}, { immediate: true })
const mayDownloadPaid = computed(() => b.value.kind === 'free' || owned.value || info.value?.isAdmin === true)
const paidMessage = computed(() => (!info.value ? 'قم بتسجيل الدخول حتى تستطيع رؤية المحتوى' : 'قم بشراء الكتاب حتى تستطيع رؤية المحتوى'))

const { liked, toggle: toggleFavourite } = useFavourite('book', id)
const added = ref(false)
function addToCart() {
  if (!canBuy.value) return
  cart.add(id)
  added.value = true
  setTimeout(() => { added.value = false }, 1000)
}

const comments = ref<BookCommentRow[]>([])
const commentsLoaded = ref(false)
async function loadComments() { comments.value = await bookComments(client, id).catch(() => []); commentsLoaded.value = true }
watch([mounted, () => info.value?.id], () => { if (mounted.value) void loadComments() }, { immediate: true })

const newComment = ref('')
const commentBusy = ref(false)
const commentMsg = ref('')
async function submitComment() {
  const body = newComment.value.trim()
  if (!body || !info.value) return
  commentBusy.value = true
  commentMsg.value = ''
  const { error } = await client.from('comments').insert({ user_id: info.value.id, book_id: id, body })
  commentBusy.value = false
  if (error) { commentMsg.value = 'تعذر إرسال التعليق'; return }
  newComment.value = ''
  commentMsg.value = 'تم إرسال تعليقك وسيظهر بعد مراجعته'
  await loadComments()
}
const ago = (iso: string) => new Intl.RelativeTimeFormat('ar', { numeric: 'auto' }).format(Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000), 'day')

onMounted(() => {
  const key = `aw_viewed_book_${id}`
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1') } catch { /* ignore */ }
  $fetch(`/api/views/book/${id}`, { method: 'POST' }).catch(() => {})
})

// ---- SEO -------------------------------------------------------------------------------------------
const plain = computed(() => (b.value.description_html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200))
useSeoMeta({
  title: b.value.title, description: plain.value || b.value.title,
  ogTitle: b.value.title, ogDescription: plain.value || undefined, ogType: 'book',
  ogImage: b.value.cover_path ? publicUrl(b.value.cover_path) : undefined,
})
useHead({
  script: [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Book', name: b.value.title, description: plain.value || undefined,
      author: makers.value.find((g) => g.role === 'author')?.list.map((m) => ({ '@type': 'Person', name: m!.name })),
      offers: { '@type': 'Offer', price: Number(b.value.price_amount).toFixed(2), priceCurrency: b.value.price_currency,
        availability: b.value.status === 'published' ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder' },
    }),
  }],
})
</script>

<template>
  <div v-if="book">
    <PageHeading :title="book.title" />
    <section class="product_wp">
      <div class="row">
        <div class="col-xl-3 col-lg-4 col-sm-6">
          <div class="product_img"><img :src="publicUrl(book.cover_path)" :alt="book.title" :title="book.title" class="img-fluid"></div>
        </div>
        <div class="col-xl-5 col-lg-4 col-sm-6">
          <div class="item">
            <i class="fa fa-money" />
            <span class="cost">
              {{ book.kind === 'free' ? 'مجانى' : Number(book.price_amount).toFixed(2) }}
              <sub v-if="book.kind === 'paid'">دولار</sub>
            </span>
          </div>
          <div v-if="categories.length" class="item">
            <i class="fa fa-book" /><span>التصنيف</span>
            <NuxtLink v-for="c in categories" :key="c!.id" :to="`/search?category=${c!.id}`" class="more">{{ c!.name }}</NuxtLink>
          </div>
          <div v-for="g in makers" :key="g.role" class="item">
            <i class="fa fa-user" /><span>{{ MAKER_KIND_LABEL[g.role] }}</span>
            <NuxtLink v-for="m in g.list" :key="m!.id" :to="`/maker/${m!.id}`">{{ m!.name }}</NuxtLink>
          </div>
          <div class="item"><i class="fa fa-user" /><span>الصفحات</span><a href="javascript:void(0)">{{ book.pages }}</a></div>
          <div class="item"><i class="fa fa-user" /><span>صيغة الملف</span><a href="javascript:void(0)">{{ fileExt }}</a></div>
          <div v-if="book.book_tags.length" class="item">
            <i class="fa fa-tag" />
            <NuxtLink v-for="t in book.book_tags" :key="t.tag" :to="{ path: '/search', query: { search: t.tag } }" class="tag">{{ t.tag }}</NuxtLink>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="cart_product">
            <div class="paid_product_media">
              <ul class="nav nav-pills">
                <li class="nav-item"><a class="nav-link" data-toggle="pill" href="#paid_file">الكتاب الإلكتروني</a></li>
                <li class="nav-item"><a class="nav-link" data-toggle="pill" href="#paid_audio">الكتاب الصوتى</a></li>
              </ul>
              <div class="tab-content">
                <div id="paid_file" class="tab-pane container fade">
                  <ul v-if="mayDownloadPaid && files('after_purchase', 'file').length" class="book_list">
                    <li v-for="m in files('after_purchase', 'file')" :key="m.id">
                      <a :href="`/api/library/download/${m.id}`" target="_blank" rel="noopener"><i class="fa fa-file-pdf-o" /> {{ m.name || 'الكتاب' }}</a>
                    </li>
                  </ul>
                  <p v-else-if="mayDownloadPaid" class="response_access">الكتاب الإلكتروني غير متوفر</p>
                  <p v-else class="response_access">{{ paidMessage }}</p>
                </div>
                <div id="paid_audio" class="tab-pane container fade">
                  <ul v-if="mayDownloadPaid && files('after_purchase', 'audio').length" class="book_list">
                    <li v-for="m in files('after_purchase', 'audio')" :key="m.id">
                      <a :href="`/api/library/download/${m.id}`" target="_blank" rel="noopener"><i class="fa fa-headphones" /> {{ m.name || 'الكتاب الصوتى' }}</a>
                    </li>
                  </ul>
                  <p v-else-if="mayDownloadPaid" class="response_access">الكتاب الصوتى غير متوفر</p>
                  <p v-else class="response_access">{{ info ? 'قم بشراء الكتاب حتى تستطيع الاستماع' : 'قم بتسجيل الدخول حتى تستطيع رؤية المحتوى' }}</p>
                </div>
              </div>
            </div>
            <div class="paid_product_media">
              <ul class="nav nav-pills">
                <li class="nav-item"><a class="nav-link" data-toggle="pill" href="#free_file">النبذة الإلكترونية</a></li>
                <li class="nav-item"><a class="nav-link" data-toggle="pill" href="#free_audio">النبذة الصوتية</a></li>
              </ul>
              <div class="tab-content">
                <div id="free_file" class="tab-pane container fade">
                  <ul v-if="files('preview', 'file').length" class="book_list">
                    <li v-for="m in files('preview', 'file')" :key="m.id">
                      <a :href="`/api/library/download/${m.id}`" target="_blank" rel="noopener"><i class="fa fa-file-pdf-o" /> {{ m.name || 'نبذة' }}</a>
                    </li>
                  </ul>
                  <p v-else class="response_access">لا توجد نبذة إلكترونية الان</p>
                </div>
                <div id="free_audio" class="tab-pane container fade">
                  <ul v-if="files('preview', 'audio').length" class="book_list">
                    <li v-for="m in files('preview', 'audio')" :key="m.id">
                      <a :href="`/api/library/download/${m.id}`" target="_blank" rel="noopener"><i class="fa fa-headphones" /> {{ m.name || 'نبذة صوتية' }}</a>
                    </li>
                  </ul>
                  <p v-else class="response_access">لا توجد نبذة صوتية الان</p>
                </div>
              </div>
            </div>
            <button v-if="canBuy && !owned" type="button" class="wp_btn btn-block addToCartBtn" @click="addToCart">
              <i class="fa" :class="added || cart.has(id) ? 'fa-check' : 'fa-cart-plus'" />
              {{ cart.has(id) ? 'في السلة' : 'أضف إلى السلة' }}
            </button>
            <NuxtLink v-else-if="owned" to="/library" class="wp_btn btn-block"><i class="fa fa-book" /> الكتاب في مكتبتك</NuxtLink>
            <div class="actions">
              <div class="row justify-content-center">
                <div class="col-12"><ShareLinks :title="book.title" :path="`/book/${book.id}`" /></div>
                <div class="col-12">
                  <button class="updateFavourite" type="button" @click="toggleFavourite"><i class="fa fa-heart" :class="{ liked_heart: liked }" /> المفضلة</button>
                </div>
                <div class="col-12">
                  <NuxtLink title="إبلاغ" class="link" style="background: #f9d568; color: #753f27" :to="{ path: '/contact', query: { subject: 'report' } }"><i class="fa fa-ban" /> إبلاغ</NuxtLink>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-12">
          <div class="about">
            <strong>حول الكتاب</strong>
            <!-- description_html is sanitised server-side on save (sanitizeRichText) -->
            <div class="words editor_txt" v-html="book.description_html" />
          </div>
        </div>
        <div class="col-12">
          <div class="related">
            <hr>
            <div class="about">
              <strong>التعليقات <template v-if="commentsLoaded">({{ comments.length }})</template></strong>
              <span v-if="mounted && !owned && book.kind === 'paid'" class="note_comment">قم بشراء الكتاب حتى تستطيع ان تشاهد جميع التعليقات</span>
            </div>
          </div>
          <div class="wp_comment">
            <p v-if="mounted && !info" class="response_access">قم بتسجيل الدخول حتى تستطيع التعليق</p>
            <form v-else-if="info" class="mb-3" @submit.prevent="submitComment">
              <div class="form-group">
                <label for="comment-body">تعليقك</label>
                <textarea id="comment-body" v-model="newComment" class="form-control" maxlength="4000" placeholder="اكتب تعليقك هنا ..." />
              </div>
              <button class="wp_btn" type="submit" :disabled="commentBusy || !newComment.trim()">{{ commentBusy ? 'جاري الإرسال…' : 'إرسال' }}</button>
              <p v-if="commentMsg" class="mt-2" role="status">{{ commentMsg }}</p>
            </form>
            <div v-for="c in comments" :key="c.id" class="block">
              <div class="row">
                <div class="col-xl-1 col-2 d-none d-sm-block"><div class="img-block"><img src="/assets/images/user.png" alt="avatar"></div></div>
                <div class="col-xl-11 col-sm-10 col-12">
                  <span class="comment_date">{{ ago(c.created_at) }}</span>
                  <p class="comment_name">{{ c.author_name }}</p>
                  <div class="comment_text">{{ c.body }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="related?.length" class="col-12">
          <div class="related">
            <hr>
            <div class="about"><strong>شاهد ايضاً</strong></div>
            <div class="row"><BookCard v-for="r in related" :key="r.id" :book="r" variant="plain" /></div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
