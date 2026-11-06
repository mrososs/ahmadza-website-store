<script setup lang="ts">
// Port of layouts/main-sidebar.blade.php (admin branch) — data-driven, with live badge counts from /api/admin/badges.
import type { AdminBadges } from '~~/shared/types/admin'
const props = defineProps<{ badges: AdminBadges | null }>()
const b = computed(() => props.badges)

type Item = [label: string, to: string | { path: string; query: Record<string, string> }, count?: number | null]
const q = (path: string, status: string) => ({ path, query: { status } })

const groups = computed<{ id: string; icon: string; label: string; items: Item[] }[]>(() => [
  { id: 'affiliate', icon: 'ti-check-box', label: 'المسوقين بالعمولة', items: [['المسوقين', '/admin/affiliates', null], ['طلبات سحب الأرباح', '/admin/withdraws', b.value?.withdrawals ?? null]] },
  { id: 'books', icon: 'ti-book', label: 'الكتب', items: [
    ['الكل', '/admin/books', b.value?.books.all], ['المفعلة', q('/admin/books', 'active'), b.value?.books.active],
    ['الغير مفعلة', q('/admin/books', 'inactive'), b.value?.books.inactive], ['قريباً', q('/admin/books', 'soon'), b.value?.books.soon],
    ['السلة', q('/admin/books', 'trash'), b.value?.books.trash]] },
  { id: 'request_book', icon: 'ti-agenda', label: 'طلبات اضافة كتاب', items: [
    ['الكل', '/admin/request-books', null], ['طلبات', q('/admin/request-books', 'pending'), b.value?.requests ?? null],
    ['موافقة', q('/admin/request-books', 'approved'), null], ['رفض', q('/admin/request-books', 'declined'), null]] },
  { id: 'statistics', icon: 'ti-export', label: 'التقارير', items: [
    ['المستخدمين', '/admin/stats/users', null], ['الكتب', '/admin/stats/books', null], ['الطلبات', '/admin/stats/orders', null], ['الأرباح', '/admin/stats/revenue', null]] },
  { id: 'pages', icon: 'ti-files', label: 'الصفحات', items: [
    ['الكل', '/admin/pages', b.value?.pages], ['المفعلة', q('/admin/pages', 'active'), null], ['الغير مفعلة', q('/admin/pages', 'inactive'), null], ['السلة', q('/admin/pages', 'trash'), null]] },
  { id: 'articles', icon: 'ti-pencil', label: 'المدونة', items: [
    ['الكل', '/admin/articles', b.value?.articles], ['المفعلة', q('/admin/articles', 'active'), null], ['الغير مفعلة', q('/admin/articles', 'inactive'), null], ['السلة', q('/admin/articles', 'trash'), null]] },
  { id: 'users', icon: 'ti-user', label: 'المستخدمين', items: [
    ['الكل', '/admin/users', b.value?.users.all], ['تحت المراجعة', q('/admin/users', 'review'), b.value?.users.review], ['مفعل', q('/admin/users', 'active'), b.value?.users.active],
    ['محظور', q('/admin/users', 'banned'), b.value?.users.banned], ['السلة', q('/admin/users', 'trash'), b.value?.users.trash]] },
  { id: 'categories', icon: 'ti-image', label: 'الأقسام', items: [
    ['الكل', '/admin/categories', b.value?.categories], ['المفعلة', q('/admin/categories', 'active'), null], ['الغير مفعلة', q('/admin/categories', 'inactive'), null], ['السلة', q('/admin/categories', 'trash'), null]] },
  { id: 'makers', icon: 'ti-pencil-alt2', label: 'المؤلفين', items: [
    ['الكل', '/admin/makers', b.value?.makers], ['المفعلة', q('/admin/makers', 'active'), null], ['الغير مفعلة', q('/admin/makers', 'inactive'), null], ['السلة', q('/admin/makers', 'trash'), null]] },
])
</script>

<template>
  <div class="side-menu-fixed">
    <div class="scrollbar side-menu-bg">
      <ul id="sidebarnav" class="nav navbar-nav side-menu">
        <li><NuxtLink to="/admin"><i class="ti-home" /><span class="right-nav-text">لوحة التحكم</span> <span class="badge badge-pill badge-warning float-right mt-1">HOT</span></NuxtLink></li>
        <li><NuxtLink to="/admin/site-info"><i class="ti-settings" /><span class="right-nav-text">معلومات الموقع</span> </NuxtLink></li>
        <li />
        <li>
          <NuxtLink to="/admin/contacts"><i class="ti-envelope" /><span class="right-nav-text">الرسائل</span>
            <span v-if="b?.contacts" class="badge badge-danger float-right mt-1">{{ b.contacts }}</span></NuxtLink>
        </li>
        <li>
          <NuxtLink to="/admin/comments"><i class="ti-comment" /><span class="right-nav-text">التعليقات</span>
            <span v-if="b?.comments" class="badge badge-danger float-right mt-1">{{ b.comments }}</span></NuxtLink>
        </li>
        <li><NuxtLink to="/admin/orders"><i class="ti-shopping-cart" /><span class="right-nav-text">الطلبات</span> </NuxtLink></li>
        <li><NuxtLink to="/admin/payments"><i class="ti-credit-card" /><span class="right-nav-text">المدفوعات</span> </NuxtLink></li>
        <li><NuxtLink to="/admin/recovery"><i class="ti-reload" /><span class="right-nav-text">استعادة الكتالوج</span> </NuxtLink></li>
        <li v-for="g in groups" :key="g.id">
          <a href="javascript:void(0);" data-toggle="collapse" :data-target="`#${g.id}`">
            <div class="pull-left"><i :class="g.icon" /><span class="right-nav-text">{{ g.label }}</span></div>
            <div class="pull-right"><i class="ti-plus" /></div><div class="clearfix" />
          </a>
          <ul :id="g.id" class="collapse" data-parent="#sidebarnav">
            <li v-for="it in g.items" :key="it[0]">
              <NuxtLink :to="it[1]">{{ it[0] }}<span v-if="it[2] !== null && it[2] !== undefined" class="badge badge-secondary mr-1 float-right">{{ it[2] }}</span></NuxtLink>
            </li>
          </ul>
        </li>
        <li><NuxtLink to="/admin/demo-data"><i class="ti-trash" /><span class="right-nav-text">بيانات تجريبية</span> </NuxtLink></li>
      </ul>
    </div>
  </div>
</template>
