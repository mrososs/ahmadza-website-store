<script setup lang="ts">
// resources/views/layouts/main-header.blade.php — affiliate branch (logo_affiliate.png, no quick-services grid).
const { info, logout } = useSessionInfo()
</script>

<template>
  <nav class="admin-header navbar navbar-default col-lg-12 col-12 p-0 fixed-top d-flex flex-row">
    <div class="text-left navbar-brand-wrapper">
      <NuxtLink class="navbar-brand brand-logo" to="/affiliate"><img src="/assets/images/logo_affiliate.png" alt=""></NuxtLink>
      <NuxtLink class="navbar-brand brand-logo-mini" to="/affiliate"><img src="/assets/images/logo-icon-dark.png" alt=""></NuxtLink>
    </div>
    <ul class="nav navbar-nav mr-auto">
      <li class="nav-item">
        <a id="button-toggle" class="button-toggle-nav inline-block ml-20 pull-left" href="javascript:void(0);"><i class="zmdi zmdi-menu ti-align-right" /></a>
      </li>
    </ul>
    <ul class="nav navbar-nav ml-auto">
      <li class="nav-item dropdown mr-30">
        <a class="nav-link nav-pill user-avatar" data-toggle="dropdown" href="#" role="button" aria-haspopup="true" aria-expanded="false">
          <img src="/assets/images/avatar.png" alt="avatar">
        </a>
        <div class="dropdown-menu dropdown-menu-right">
          <div class="dropdown-header">
            <div class="media">
              <div class="media-body">
                <h5 class="mt-0 mb-0">{{ info?.displayName }}</h5>
                <span>{{ info?.email }}</span>
              </div>
            </div>
          </div>
          <div class="dropdown-divider" />
          <NuxtLink class="dropdown-item" to="/update-profile"><i class="text-info ti-settings" />بيانات الدخول</NuxtLink>
          <NuxtLink class="dropdown-item" to="/"><i class="text-info ti-home" />الموقع</NuxtLink>
          <a class="dropdown-item" href="#" @click.prevent="logout"><i class="text-danger ti-unlock" />تسجيل الخروج</a>
        </div>
      </li>
    </ul>
  </nav>
</template>
