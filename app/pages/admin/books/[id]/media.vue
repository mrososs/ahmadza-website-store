<script setup lang="ts">
// Port of admin/book/content.blade.php: book summary card + media manager (upload / external link / order / visibility).
definePageMeta({ layout: 'admin', middleware: ['admin'] })
const route = useRoute()
const id = Number(route.params.id)
const { publicUrl } = useMediaUrl()

interface Book { id: number; title: string; kind: string; status: string; price_amount: number | string; price_currency: string; view_count: number; pages: number; cover_path: string | null; tags: string[] }
const { data: book, error, refresh } = await useFetch<Book>(`/api/admin/books/${id}`, { server: false, key: `admin-book-${id}` })
useAdminTitle(() => book.value?.title ?? 'المحتويات')

useHead({
  style: [{ key: 'admin-book-content', innerHTML: `
    #result_message{display:none}
    .product_content{background:#282a39;color:#fff;box-shadow:rgba(0,0,0,.24) 0 3px 8px;padding:10px;border-radius:10px}
    .product_content .img_block{height:100%}
    .product_content .img_block img{object-fit:cover;height:100%}
    .product_content .name{font-weight:bold;font-size:18px;margin:0;padding:0;color:#c3c3c3}
    .product_content hr{background:#ffc107;height:5px;width:20%;display:inline-block;margin:5px 0;border:0;margin-bottom:0}
    .product_content .data{padding:11px 0;border-bottom:1px solid #3e3e3e;color:#ececec;font-weight:bold}
    .product_content .data:last-child{border-bottom:0}
    .product_content .data i{width:20px;margin-left:5px;color:#fff;font-size:10px}
    .product_content .tag_name{background:#ffc107;color:#282a39;padding:2px 4px;font-size:11px;font-weight:normal;border-radius:5px}
    .product_media_show{margin-top:15px;background:#fff;padding:15px;border:1px solid #f2f2f2;box-shadow:rgba(149,157,165,.2) 0 8px 24px}
    .product_media_show td input{text-align:center}
    .block-file{background:#eee;padding:10px;margin-bottom:15px;box-shadow:rgba(149,157,165,.2) 0 8px 24px;border:1px solid #e8e7e7}
  ` }],
})
</script>

<template>
  <div>
    <div v-if="error" class="alert alert-danger" role="alert">{{ adminErrorMessage(error) }} <a href="#" @click.prevent="refresh()">إعادة المحاولة</a></div>
    <template v-else-if="book">
      <section class="product_content">
        <div class="row">
          <div class="col-md-4"><div class="img_block"><img :title="book.title" :alt="book.title" class="img-fluid" :src="publicUrl(book.cover_path)"></div></div>
          <div class="col-md-8">
            <h1 class="name">{{ book.title }}</h1>
            <hr>
            <div class="data" title="النوع"><i class="fa fa-anchor" /> {{ book.kind === 'free' ? 'مجانى' : 'مدفوع' }}</div>
            <div class="data" title="التكلفة"><i class="fa fa-money" /> {{ Number(book.price_amount).toFixed(2) }} دولار</div>
            <div class="data" title="الحالة"><i class="fa fa-cogs" /> {{ STATUS_BADGE[book.status]?.label }}</div>
            <div class="data" title="المشاهدات"><i class="fa fa-eye" /> {{ book.view_count }}</div>
            <div class="data" title="عدد الصفحات"><i class="fa fa-file-o" /> <span id="total_book_count">{{ book.pages }}</span></div>
            <div class="data" title="الكلمات المفتاحية"><i class="fa fa-tag" /> <span v-for="t in book.tags" :key="t" class="tag_name">{{ t }}</span></div>
          </div>
          <div class="col-12">
            <div class="text-right">
              <NuxtLink class="button" :to="`/admin/books/${id}`"><i class="fa fa-edit" /> تعديل</NuxtLink>
            </div>
          </div>
        </div>
      </section>
      <BookMediaManager :book-id="id" @changed="refresh()" />
    </template>
    <div v-else class="text-center p-5" role="status"><i class="fa fa-spinner fa-spin" /> جاري التحميل…</div>
  </div>
</template>
