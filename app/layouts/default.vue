<script setup lang="ts">
// Storefront shell — port of resources/views/front/master.blade.php (same stylesheet order, same DOM).
// Pages choose the optional poster / statistics bands through definePageMeta({ showPoster, showStats }).
const route = useRoute()
const { data: shell } = await useShell()
const { publicUrl } = useMediaUrl()

useHead({
  link: [
    '/assets/css/plugins/bootstrap.css',
    '/assets/css/plugins/font-awesome.css',
    '/assets/css/plugins/dropify.css',
    '/assets/css/plugins/bootstrap-select.min.css',
    '/assets/css/plugins/lightbox.min.css',
    '/assets/css/front.css',
    '/assets/css/media.css',
    '/css/aawraq-refine.css', // refinement layer (additive; legacy CSS untouched)
  ].map((href) => ({ rel: 'stylesheet', href })),
})

const showPoster = computed(() => !!route.meta.showPoster)
const showStats = computed(() => !!route.meta.showStats)
const s = computed(() => shell.value?.settings)
</script>

<template>
  <section class="body">
    <SiteHeader />
    <template v-if="showPoster && s">
      <section v-if="s.show_poster_desktop && s.poster_path" class="main_poster_sec text-center">
        <img class="img-fluid d-md-block d-none" :src="publicUrl(s.poster_path)" :alt="s.site_name">
      </section>
      <section v-if="s.show_poster_mobile && s.poster_mobile_path" class="main_poster_sec text-center">
        <img class="img-fluid d-block d-md-none" :src="publicUrl(s.poster_mobile_path)" :alt="s.site_name">
      </section>
    </template>
    <div class="body-content">
      <div class="container-fluid">
        <div class="row">
          <div class="col-lg-9 col-md-8">
            <slot />
          </div>
          <div class="col-lg-3 col-md-4">
            <SiteSidebar />
          </div>
        </div>
      </div>
    </div>
    <SiteStatistics v-if="showStats" />
    <SiteFooter />
  </section>
</template>
