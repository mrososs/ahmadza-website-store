<script setup lang="ts">
// layouts/main-sidebar.blade.php — affiliate branch.
const { info } = useSessionInfo()
const siteLink = computed(() => (info.value ? `/?aff=${info.value.id}` : '/'))
</script>

<template>
  <div class="side-menu-fixed">
    <div class="scrollbar side-menu-bg">
      <ul id="sidebarnav" class="nav navbar-nav side-menu">
        <li><NuxtLink to="/affiliate"><i class="ti-home" /><span class="right-nav-text">الإحصائيات</span> <span class="badge badge-pill badge-warning float-right mt-1">جديد</span></NuxtLink></li>
        <li><a :href="siteLink" target="_blank"><i class="ti-link" /><span class="right-nav-text">رابط الموقع الخاص بك</span></a></li>
        <li><NuxtLink to="/affiliate/books"><i class="ti-book" /><span class="right-nav-text">الكتب</span></NuxtLink></li>
        <li><NuxtLink to="/affiliate/profit"><i class="ti-money" /><span class="right-nav-text">الأرباح</span></NuxtLink></li>
        <li><NuxtLink to="/affiliate/withdraw-settings"><i class="ti-cloud" /><span class="right-nav-text">إعدادت السحب</span></NuxtLink></li>
        <li><NuxtLink to="/affiliate/withdraw"><i class="ti-write" /><span class="right-nav-text">سحب الأرباح</span></NuxtLink></li>
      </ul>
    </div>
  </div>
</template>
