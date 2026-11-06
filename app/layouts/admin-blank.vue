<script setup lang="ts">
// Admin shell without header / sidebar (admin login) — master.blade.php with $empty_template.
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
})
</script>

<template>
  <section class="wrapper">
    <div class="container-fluid"><slot /></div>
  </section>
</template>
