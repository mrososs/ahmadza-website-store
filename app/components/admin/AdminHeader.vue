<script setup lang="ts">
// Port of layouts/main-header.blade.php (admin branch) with the real admin name / e-mail and a working logout.
defineProps<{ me: { displayName: string; email: string | null } | null }>()
const client = useSupabaseClient()
async function logout() {
  await client.auth.signOut()
  await navigateTo('/admin/login')
}
</script>

<template>
  <nav class="admin-header navbar navbar-default col-lg-12 col-12 p-0 fixed-top d-flex flex-row">
    <div class="text-left navbar-brand-wrapper">
      <NuxtLink class="navbar-brand brand-logo" to="/admin"><img src="/assets/images/logo.png" alt="لوحة التحكم"></NuxtLink>
      <NuxtLink class="navbar-brand brand-logo-mini" to="/admin"><img src="/assets/images/logo-icon-dark.png" alt="لوحة التحكم"></NuxtLink>
    </div>
    <ul class="nav navbar-nav mr-auto">
      <li class="nav-item">
        <a id="button-toggle" class="button-toggle-nav inline-block ml-20 pull-left" href="javascript:void(0);" aria-label="القائمة"><i class="zmdi zmdi-menu ti-align-right" /></a>
      </li>
    </ul>
    <ul class="nav navbar-nav ml-auto">
      <li class="nav-item dropdown">
        <a class="nav-link top-nav" data-toggle="dropdown" href="#" role="button" aria-haspopup="true" aria-expanded="true" aria-label="خدمات سريعة"><i class="ti-view-grid" /></a>
        <div class="dropdown-menu dropdown-menu-right dropdown-big">
          <div class="dropdown-header"><strong>خدمات سريعة</strong></div>
          <div class="dropdown-divider" />
          <div class="nav-grid">
            <NuxtLink to="/admin/pages/create" class="nav-grid-item"><i class="ti-files text-primary" /><h5>إضافة صفحة</h5></NuxtLink>
            <NuxtLink to="/admin/articles/create" class="nav-grid-item"><i class="ti-check-box text-success" /><h5>إضافة مقال</h5></NuxtLink>
          </div>
          <div class="nav-grid">
            <NuxtLink to="/admin/books/create" class="nav-grid-item"><i class="ti-book text-warning" /><h5>إضافة كتاب</h5></NuxtLink>
            <NuxtLink to="/admin/makers/create" class="nav-grid-item"><i class="ti-user text-danger" /><h5>إضافة مؤلف</h5></NuxtLink>
          </div>
        </div>
      </li>
      <li class="nav-item dropdown mr-30">
        <a class="nav-link nav-pill user-avatar" data-toggle="dropdown" href="#" role="button" aria-haspopup="true" aria-expanded="false" aria-label="الحساب"><img src="/assets/images/avatar.png" alt="avatar"></a>
        <div class="dropdown-menu dropdown-menu-right">
          <div class="dropdown-header">
            <div class="media"><div class="media-body">
              <h5 class="mt-0 mb-0">{{ me?.displayName || 'المدير' }}</h5>
              <span>{{ me?.email }}</span>
            </div></div>
          </div>
          <div class="dropdown-divider" />
          <NuxtLink class="dropdown-item" to="/admin/edit-profile"><i class="text-info ti-settings" />بيانات الدخول</NuxtLink>
          <NuxtLink class="dropdown-item" to="/admin/security"><i class="text-warning ti-lock" />التحقق بخطوتين</NuxtLink>
          <NuxtLink class="dropdown-item" to="/"><i class="text-success ti-home" />عرض الموقع</NuxtLink>
          <a class="dropdown-item" href="#" @click.prevent="logout"><i class="text-danger ti-unlock" />تسجيل الخروج</a>
        </div>
      </li>
    </ul>
  </nav>
</template>
