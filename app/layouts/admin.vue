<script setup lang="ts">
// Webmin admin shell — port of layouts/master.blade.php (admin branch). Stylesheet order as in the legacy head.
import type { AdminBadges } from '~~/shared/types/admin'

const route = useRoute()
const title = useState<string>('admin-title', () => '')

useHead({
  link: [
    '/assets/css/plugins/bootstrap.css',
    '/assets/css/plugins/font-awesome.css',
    '/assets/css/plugins/dropify.css',
    '/assets/css/plugins/bootstrap-select.min.css',
    '/assets/css/plugins/buttons.dataTables.min.css',
    '/assets/css/plugins/daterangepicker.css',
    '/assets/css/admin.css',
  ].map((href) => ({ rel: 'stylesheet', href })),
  // the Webmin sidebar is an off-canvas panel on small screens: keep it from widening the page
  style: [{ innerHTML: '.wrapper{overflow-x:clip}' }],
})

const { data: me } = useFetch<{ displayName: string; email: string | null }>('/api/admin/me', { server: false, key: 'admin-me' })
const { data: badges, refresh: refreshBadges } = useFetch<AdminBadges>('/api/admin/badges', { server: false, key: 'admin-badges' })
// counters change after mutations: refresh on every navigation inside the admin area
watch(() => route.fullPath, () => { void refreshBadges() })
</script>

<template>
  <section class="wrapper">
    <AdminHeader :me="me ?? null" />
    <div class="container-fluid">
      <AdminSidebar :badges="badges ?? null" />
      <div class="content-wrapper">
        <div class="page-title">
          <div class="row">
            <div class="col-sm-6"><h4 class="mb-0">{{ title }}</h4></div>
            <div class="col-sm-6">
              <ol class="breadcrumb pt-0 pr-0 float-left float-sm-right">
                <li class="breadcrumb-item"><NuxtLink to="/admin" class="default-color">الرئيسية</NuxtLink></li>
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

<style>
/* Row «عمليات» dropdowns. Two faults: (1) the wrapper around the button is a plain <div>, not a positioned .dropdown, so the absolutely positioned menu was placed
   relative to a distant ancestor, far below its button (under the table); (2) the menu sits inside .table-responsive, whose overflow clips it. */
td > div:has(> [data-toggle='dropdown']) { position: relative; display: inline-block; }
/* desktop width: the table fits, so it need not scroll sideways: let the menu escape (div.table-responsive outranks the template's own .table-responsive rule) */
@media (min-width: 992px) {
  div.table-responsive { overflow: visible; }
}
/* phone: the wrapper must keep scrolling, so it grows by the height of an open menu */
@media (max-width: 991.98px) {
  div.table-responsive:has(.dropdown-menu.show) { padding-bottom: 9rem; }
}
</style>
