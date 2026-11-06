<script setup lang="ts">
// Port of resources/views/front/footer.blade.php. Contact values and CMS footer pages come from the database.
const { data: shell } = await useShell()
const s = computed(() => shell.value?.settings)
const footerPages = computed(() => (shell.value?.pages ?? []).filter((p) => p.positions?.includes('footer')))

// legacy: three columns, links split evenly — contact + request-book first, then CMS footer pages
const columns = computed(() => {
  const links = [
    { title: 'تواصل معنا', to: '/contact' },
    { title: 'طلب اضافة كتاب', to: '/request-book' },
    ...footerPages.value.map((p) => ({ title: p.title, to: `/p/${p.slug}` })),
  ]
  const per = Math.max(1, Math.round(links.length / 3))
  return [links.slice(0, per), links.slice(per, per * 2), links.slice(per * 2)].filter((c) => c.length)
})
const year = new Date().getFullYear()
const social = computed(() => [
  { key: 'facebook', title: 'فيسبوك', img: 'facebook' }, { key: 'instagram', title: 'انستغرام', img: 'instagram' },
  { key: 'twitter', title: 'تويتر', img: 'twitter' }, { key: 'youtube', title: 'يوتيوب', img: 'youtube' },
  { key: 'whatsapp', title: 'واتساب', img: 'whatsapp' }, { key: 'telegram', title: 'تيلغرام', img: 'telegram' },
] as const)
</script>

<template>
  <section class="footer_wp">
    <div class="one">
      <div class="container-fluid">
        <div class="row">
          <div class="col-md-4">
            <h1>للدعم والمساندة</h1>
            <span class="sub_title" />
          </div>
          <div class="col-md-8">
            <ul class="list-unstyled">
              <li v-if="s?.email" class="email">
                <a :href="`mailto:${s.email}`"><span class="name">الدعم عبر البريد الإلكتروني</span><span class="value">{{ s.email }}</span></a>
              </li>
              <li v-if="s?.whatsapp" class="whatsapp">
                <a :href="s.whatsapp.startsWith('http') ? s.whatsapp : `https://wa.me/${s.whatsapp.replace(/\D/g, '')}`" rel="noopener"><span class="name">الدعم عبر الواتساب</span><span class="value">{{ s.whatsapp }}</span></a>
              </li>
              <li v-if="s?.phone" class="phone">
                <a :href="`tel:${s.phone}`"><span class="name">الدعم عبر الهاتف</span><span class="value">{{ s.phone }}</span></a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <div class="two">
      <div class="container-fluid">
        <div class="row">
          <div class="col-12">
            <div class="payment">
              <img class="img-fluid" src="/assets/images/onlinepayment.webp" alt="وسائل الدفع" title="وسائل الدفع">
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="three">
      <div class="container-fluid">
        <div class="row">
          <div class="col-12">
            <div class="row justify-content-center">
              <div v-for="(col, i) in columns" :key="i" class="col-md">
                <ul class="list-unstyled">
                  <li v-for="l in col" :key="l.to"><i class="fa fa-external-link" /> <NuxtLink :title="l.title" :to="l.to">{{ l.title }}</NuxtLink></li>
                </ul>
              </div>
            </div>
          </div>
          <div class="col-12">
            <div class="social">
              <template v-for="sc in social" :key="sc.key">
                <a v-if="s && s[sc.key]" :href="s[sc.key] as string" :title="sc.title" target="_blank" rel="noopener noreferrer">
                  <img :src="`/assets/images/${sc.img}.webp`" :alt="sc.title" :title="sc.title">
                </a>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="copy">
      <div class="container-fluid">
        <div class="row">
          <div class="col-12 text-center">
            <span>جميع الحقوق محفوظة , {{ s?.site_name ?? 'أوراق عربية' }} 2022 - {{ year }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
