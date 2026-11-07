<script setup lang="ts">
// Port of resources/views/front/navbar.blade.php (legacy markup and class names preserved).
const { data: shell } = await useShell()
const { publicUrl } = useMediaUrl()
const { info, isAuthed, logout } = useSessionInfo()
const cart = useCartStore()
const recovered = useRecoveredSummary() // protected preview only: a link to the recovered catalogue under review, shown when it has books
const recoveredCount = computed(() => (recovered.data.value?.enabled ? recovered.data.value.total : 0))
const router = useRouter()
const q = ref('')
onMounted(() => cart.hydrate())

const logo = computed(() => (shell.value?.settings?.logo_path ? publicUrl(shell.value.settings.logo_path) : '/images/icons/icon-512x512.png'))
const siteName = computed(() => shell.value?.settings?.site_name ?? 'أوراق عربية')
const headerPages = computed(() => (shell.value?.pages ?? []).filter((p) => p.positions?.includes('header')))
const termsPage = computed(() => (shell.value?.pages ?? []).find((p) => p.slug === 'terms'))

function submitSearch() {
  router.push({ path: '/search', query: q.value.trim() ? { search: q.value.trim() } : {} })
}
</script>

<template>
  <section class="wp_nav">
    <div class="trial">
      <div class="container">
        <p>
          <i class="fa fa-rocket" />
          إطلاق تجريبي
        </p>
      </div>
    </div>
    <div class="f_nav">
      <div class="container-fluid">
        <div class="row">
          <div class="col-xl-2 col-md-2 col-12">
            <div class="row">
              <div class="col-md-12 col-8">
                <div class="logo">
                  <NuxtLink class="navbar-brand" to="/">
                    <img :src="logo" class="img-fluid" :title="siteName" :alt="siteName">
                  </NuxtLink>
                </div>
              </div>
              <div class="col-4 d-block d-md-none text-right">
                <NuxtLink v-if="!isAuthed" to="/login" class="cart" title="الدخول"><i class="fa fa-user" /></NuxtLink>
                <NuxtLink to="/cart" class="cart" title="السلة"><i class="fa fa-cart-plus" /></NuxtLink>
              </div>
            </div>
          </div>
          <div class="col-xl-3 col-md-3 col-12 d-none d-md-block">
            <form class="search_form" role="search" @submit.prevent="submitSearch">
              <div class="input-group is-invalid">
                <input v-model="q" placeholder="أبحث عن كتاب..." class="form-control" name="search" aria-label="بحث">
                <div class="input-group-append">
                  <button class="btn" type="submit" aria-label="بحث"><i class="fa fa-search" /></button>
                </div>
              </div>
            </form>
          </div>
          <div class="col-xl-7 col-md-7 col-12 d-none d-md-block">
            <ul>
              <li><NuxtLink class="nav-link" to="/"><i class="fa fa-home" /> الرئيسية</NuxtLink></li>
              <li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle" href="#" role="button" data-toggle="dropdown" aria-expanded="false">الأقسام</a>
                <div class="dropdown-menu">
                  <NuxtLink v-for="c in shell?.categories ?? []" :key="c.id" class="dropdown-item" :to="{ path: '/search', query: { category: c.id } }">{{ c.name }}</NuxtLink>
                </div>
              </li>
              <li><NuxtLink class="nav-link" to="/authors"><i class="fa fa-users" /> المؤلفون</NuxtLink></li>
              <li><NuxtLink class="nav-link" to="/articles"><i class="fa fa-pencil" /> المدونة</NuxtLink></li>
              <li v-if="recoveredCount"><NuxtLink class="nav-link" to="/recovered"><i class="fa fa-search" /> كتب مستعادة (قيد المراجعة)</NuxtLink></li>
              <li v-for="p in headerPages" :key="p.slug"><NuxtLink class="nav-link" :to="`/p/${p.slug}`">{{ p.title }}</NuxtLink></li>
              <li v-if="isAuthed" class="nav-item dropdown">
                <a href="#" class="nav-link dropdown-toggle" data-toggle="dropdown"><i class="fa fa-user" /> الصفحة الشخصية</a>
                <div class="dropdown-menu rounded-0 m-0">
                  <NuxtLink v-if="info?.isAdmin" class="dropdown-item" to="/admin">لوحة التحكم</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/affiliate">برنامج التسويق بالعمولة</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/update-profile">تعديل بياناتى</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/request-book">طلب إضافة كتاب</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/user-book">كتابى</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/invoices">الفواتير</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/favourites">قائمة المفضلة</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/library">المكتبة</NuxtLink>
                  <a class="dropdown-item" href="#" @click.prevent="logout">تسجيل الخروج</a>
                </div>
              </li>
              <template v-else>
                <li><NuxtLink class="nav-link" to="/login"><i class="fa fa-user" /> تسجيل الدخول</NuxtLink></li>
                <li><NuxtLink class="nav-link" to="/affiliate-register"><i class="fa fa-dollar" /> سوٌق معنا</NuxtLink></li>
              </template>
              <li v-if="termsPage"><NuxtLink class="nav-link" :title="termsPage.title" :to="`/p/${termsPage.slug}`"><i class="fa fa-file" /> {{ termsPage.title }}</NuxtLink></li>
              <li>
                <NuxtLink class="nav-link" to="/cart">
                  <i class="fa fa-cart-plus" /> السلة
                  <span id="number_product">{{ cart.hydrated && cart.count ? cart.count : '' }}</span>
                </NuxtLink>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <div class="s_nav d-block d-md-none">
      <nav class="navbar navbar-expand-md">
        <div class="container-fluid">
          <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarSupportedContent" aria-controls="navbarSupportedContent" aria-expanded="false" aria-label="Toggle navigation">
            <i class="fa fa-bars" />
          </button>
          <div id="navbarSupportedContent" class="collapse navbar-collapse justify-content-center">
            <ul class="navbar-nav mb-0 mb-lg-0 mr-auto">
              <li class="nav-item d-block d-md-none">
                <form class="search_form p-0" role="search" @submit.prevent="submitSearch">
                  <div class="input-group is-invalid">
                    <input v-model="q" placeholder="أبحث عن كتاب..." class="form-control" name="search" aria-label="بحث">
                    <div class="input-group-append">
                      <button class="btn" type="submit" aria-label="بحث"><i class="fa fa-search" /></button>
                    </div>
                  </div>
                </form>
              </li>
              <li class="nav-item d-block d-md-none"><NuxtLink class="nav-link" to="/"><i class="fa fa-home" /> الرئيسية</NuxtLink></li>
              <li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle" href="#" role="button" data-toggle="dropdown" aria-expanded="false"><i class="fa fa-file" /> الأقسام</a>
                <div class="dropdown-menu">
                  <NuxtLink v-for="c in shell?.categories ?? []" :key="c.id" class="dropdown-item" :to="{ path: '/search', query: { category: c.id } }">{{ c.name }}</NuxtLink>
                </div>
              </li>
              <li class="nav-item d-block d-md-none"><NuxtLink class="nav-link" to="/authors"><i class="fa fa-users" /> المؤلفون</NuxtLink></li>
              <li class="nav-item d-block d-md-none"><NuxtLink class="nav-link" to="/articles"><i class="fa fa-pencil" /> المدونة</NuxtLink></li>
              <li v-if="recoveredCount" class="nav-item d-block d-md-none"><NuxtLink class="nav-link" to="/recovered"><i class="fa fa-search" /> كتب مستعادة (قيد المراجعة)</NuxtLink></li>
              <li v-if="isAuthed" class="nav-item dropdown d-block d-md-none">
                <a href="#" class="nav-link dropdown-toggle" data-toggle="dropdown"><i class="fa fa-user" /> الصفحة الشخصية</a>
                <div class="dropdown-menu rounded-0 m-0">
                  <NuxtLink v-if="info?.isAdmin" class="dropdown-item" to="/admin">لوحة التحكم</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/affiliate"><i class="fa fa-dollar" /> برنامج التسويق بالعمولة</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/update-profile">تعديل بياناتى</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/request-book">طلب إضافة كتاب</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/user-book">كتابى</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/favourites">قائمة المفضلة</NuxtLink>
                  <NuxtLink class="dropdown-item" to="/library">المكتبة</NuxtLink>
                  <a class="dropdown-item" href="#" @click.prevent="logout">تسجيل الخروج</a>
                </div>
              </li>
              <template v-else>
                <li class="nav-item d-block d-md-none"><NuxtLink class="nav-link" to="/login"><i class="fa fa-user" /> تسجيل الدخول</NuxtLink></li>
                <li class="nav-item d-block d-md-none"><NuxtLink class="nav-link" to="/affiliate-register"><i class="fa fa-dollar" /> سوٌق معنا</NuxtLink></li>
              </template>
              <li v-if="termsPage"><NuxtLink class="nav-link d-block d-md-none" :title="termsPage.title" :to="`/p/${termsPage.slug}`"><i class="fa fa-file" /> {{ termsPage.title }}</NuxtLink></li>
            </ul>
          </div>
        </div>
      </nav>
    </div>
  </section>
</template>
