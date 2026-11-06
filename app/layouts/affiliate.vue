<script setup lang="ts">
// Affiliate shell = the Webmin shell (resources/views/layouts/master.blade.php, affiliate branch of
// main-header / main-sidebar). Same stylesheet order as the admin shell; the page title comes from route.meta.title.
const route = useRoute()
const title = computed(() => String(route.meta.title ?? ''))

useHead({
  title: () => title.value,
  link: [
    '/assets/css/plugins/bootstrap.css',
    '/assets/css/plugins/font-awesome.css',
    '/assets/css/plugins/dropify.css',
    '/assets/css/plugins/bootstrap-select.min.css',
    '/assets/css/plugins/buttons.dataTables.min.css',
    '/assets/css/plugins/daterangepicker.css',
    '/assets/css/admin.css',
  ].map((href) => ({ rel: 'stylesheet', href })),
})
</script>

<template>
  <section class="wrapper">
    <AffiliateHeader />
    <div class="container-fluid">
      <AffiliateSidebar />
      <div class="content-wrapper">
        <div class="page-title">
          <div class="row">
            <div class="col-sm-6">
              <h4 class="mb-0">{{ title }}</h4>
            </div>
            <div class="col-sm-6">
              <ol class="breadcrumb pt-0 pr-0 float-left float-sm-right">
                <li class="breadcrumb-item"><NuxtLink to="/affiliate" class="default-color">الرئيسية</NuxtLink></li>
                <li class="breadcrumb-item active">{{ title }}</li>
              </ol>
            </div>
          </div>
        </div>
        <slot />
      </div>
    </div>
  </section>
</template>
