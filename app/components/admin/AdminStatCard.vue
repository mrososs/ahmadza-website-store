<script setup lang="ts">
// .card-statistics widget — port of admin/dashboard.blade.php.
defineProps<{ color: string; icon: string; label: string; to: string; total: number | string; today?: number; subicon?: string }>()
</script>

<template>
  <div class="col-xl-3 col-lg-6 col-md-6 mb-30">
    <div class="card card-statistics h-100">
      <div class="card-body">
        <div class="clearfix">
          <div class="float-right"><span :class="`text-${color}`"><i class="fa highlight-icon" :class="icon" aria-hidden="true" /></span></div>
          <div class="float-left text-left">
            <p class="card-text text-dark"><NuxtLink :to="to"><i class="fa fa-external-link" /> {{ label }}</NuxtLink></p>
            <h4>{{ total }}</h4>
          </div>
        </div>
        <p v-if="today !== undefined" class="text-muted pt-3 mb-0 mt-2 border-top"><i class="fa mr-1" :class="subicon ?? 'fa-bookmark-o'" aria-hidden="true" /> اليوم : {{ today }}</p>
      </div>
    </div>
  </div>
</template>
