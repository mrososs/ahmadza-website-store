<script setup lang="ts">
// Port of resources/views/front/cart/index.blade.php. Prices/totals/payment come from the server (useCheckout);
// the browser only keeps book ids. Guest checkout with silent account creation (legacy AUTH-08/ORD-05) is replaced by
// "sign in or register first" — no password is ever generated, stored or mailed.
import { loginSchema } from '~~/shared/schemas'

useHead({ style: [{ innerHTML: '#credit-card-details{min-height:190px;padding:10px;border:1px solid #e5e5e5;border-radius:4px;background:#fff}#error-handler{min-height:22px;margin-top:8px;color:#dc3545;direction:ltr;text-align:center}' }] })

const cart = useCartStore()
const { publicUrl } = useMediaUrl()
const { isAuthed } = useSessionInfo()
const client = useSupabaseClient()
const { quote, loading, error, notices, refreshQuote, startPayment } = useCheckout()

const ready = ref(false)
const paying = ref(false)
const payError = ref('')
const loginOpen = ref(false)
const pledgeOpen = ref(false)
const agreed = ref(false)
const showAgreeError = ref(false)
const login = reactive({ email: '', password: '' })
const { errors: loginErrors, busy: loginBusy, failure: loginFailure, validate: validateLogin } = useZodForm(loginSchema, login)

onMounted(async () => {
  cart.hydrate()
  await refreshQuote()
  ready.value = true
})
watch(() => cart.ids.length, () => { if (ready.value) void refreshQuote() })

const items = computed(() => quote.value?.items ?? [])
const empty = computed(() => ready.value && !cart.ids.length)
const price = (n: number) => n.toFixed(2)

function remove(id: number) {
  if (window.confirm('هل تريد إزالة هذا الكتاب من السلة؟')) cart.remove(id)
}

async function doLogin() {
  loginFailure.value = ''
  if (!validateLogin()) return
  loginBusy.value = true
  const { error: err } = await client.auth.signInWithPassword({ email: login.email.trim().toLowerCase(), password: login.password })
  loginBusy.value = false
  if (err) { loginFailure.value = authMessage(err); return }
  loginOpen.value = false
}

function onPay() {
  payError.value = ''
  if (!items.value.length) return
  if (!isAuthed.value) { loginOpen.value = true; return }
  agreed.value = false; showAgreeError.value = false
  pledgeOpen.value = true
}

async function confirmPledge() {
  if (!agreed.value) { showAgreeError.value = true; return }
  pledgeOpen.value = false
  paying.value = true
  const r = await startPayment()
  paying.value = false
  if (!r.ok) { payError.value = r.message; return }
  await navigateTo(r.redirectUrl, { external: /^https?:/.test(r.redirectUrl) })
}
</script>

<template>
  <div>
    <PageHeading title="السلة" />
    <section class="wp_cart">
      <div v-if="empty" id="empty_div" style="display: block">
        <div class="row">
          <div class="col-12">
            <img src="/assets/images/empty-cart.png" class="img-fluid" alt="">
            <h3>عربة التسوق الخاصة بك فارغة</h3>
            <NuxtLink to="/" class="wp_btn">ابدأ التسوق الان</NuxtLink>
          </div>
        </div>
      </div>
      <div v-else-if="!ready" id="load_cart" role="status">
        <div class="part"><i class="fa fa-spinner fa-spin" /><p>جاري تحميل السلة…</p></div>
      </div>
      <div v-else class="row">
        <div class="col-12">
          <div v-for="n in notices" :key="n" class="alert alert-info" role="status">{{ n }}</div>
          <div v-if="error" class="alert alert-danger" role="alert">{{ error }} <a href="#" @click.prevent="refreshQuote()">إعادة المحاولة</a></div>
        </div>
        <div class="col-md-7 col-sm-8">
          <div class="head_cart">
            <span class="num">1.</span><span class="txt">المشتريات</span><i class="fa fa-check-square" />
          </div>
          <div id="products_cart" class="products">
            <div v-for="b in items" :key="b.id" class="block">
              <div class="row">
                <div class="col-3">
                  <div class="img-block"><img :src="publicUrl(b.cover_path)" :alt="b.title" :title="b.title" class="img-fluid"></div>
                </div>
                <div class="col-9">
                  <span class="price">{{ price(b.unit_price) }} <sub>دولار</sub></span>
                  <p class="name">{{ b.title }}</p>
                  <button type="button" class="link removeCartBtn" @click="remove(b.id)"><i class="fa fa-trash" /> إزالة</button>
                  <NuxtLink :to="`/book/${b.id}/${b.slug}`" class="link"><i class="fa fa-eye" /> عرض</NuxtLink>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-5 col-sm-4">
          <div class="head_cart">
            <span class="num">2.</span><span class="txt">ملخص الطلبية</span><i class="fa fa-shopping-cart" />
          </div>
          <div class="summery">
            <div class="info">
              <span class="key">عدد العناصر</span>
              <span id="count_cart_item" class="value"><span>{{ items.length }}</span> <sub>عنصر</sub></span>
            </div>
            <div class="info">
              <span class="key">المجموع الكلى</span>
              <span id="total_cart_item" class="value"><span>{{ price(quote?.total ?? 0) }}</span> <sub>دولار</sub></span>
            </div>
          </div>
          <div class="head_cart">
            <span class="num">3.</span><span class="txt">الدفع</span><i class="fa fa-cc-visa" />
          </div>
          <div class="summery">
            <form id="payment-form-container" @submit.prevent="onPay">
              <div v-if="!isAuthed" class="temp_login_elm">
                <p class="login">
                  هل لديـك حساب ؟
                  <button type="button" class="open_modal" @click="loginOpen = true">تسجيل الدخول</button>
                </p>
                <p class="login">
                  أو
                  <NuxtLink :to="{ path: '/register', query: { redirect: '/cart' } }" class="wp_link" style="text-decoration: underline">إنشاء حساب جديد</NuxtLink>
                </p>
              </div>
              <div id="error-handler" role="alert">{{ payError }}</div>
              <button class="wp_btn btn-block" type="submit" :disabled="paying || !items.length || loading">
                <i class="fa" :class="paying ? 'fa-spinner fa-spin' : 'fa-lock'" />
                أدفع الان
                <span id="btn_pay_cost">{{ price(quote?.total ?? 0) }}</span>
                USD
              </button>
              <span class="secure_txt"><i class="fa fa-lock" /> البيانات محمية 100%</span>
            </form>
          </div>
        </div>
      </div>

      <!-- login-in-place (legacy #login_modal) -->
      <CartModal id="login_modal" :open="loginOpen" @close="loginOpen = false">
        <div class="modal-header">
          <h4 class="modal-title w-100 d-block text-center">تسجيـل الدخـول</h4>
          <button type="button" class="close" aria-label="إغلاق" @click="loginOpen = false">&times;</button>
        </div>
        <div class="modal-body">
          <form class="wp_form" id="form_cart_login" novalidate @submit.prevent="doLogin">
            <div v-if="loginFailure" class="alert alert-danger" role="alert">{{ loginFailure }}</div>
            <div class="form-group">
              <label for="cart_login_email">البريد الإلكترونى</label>
              <input id="cart_login_email" v-model="login.email" placeholder="البريد الإلكترونى" class="form-control" name="email" type="email" autocomplete="username">
              <span class="invalid-feedback err-login d-block">{{ loginErrors.email }}</span>
            </div>
            <div class="form-group">
              <label for="password">كلمة المرور</label>
              <input id="password" v-model="login.password" placeholder="كلمة المرور" type="password" class="form-control" name="password" autocomplete="current-password">
              <span class="invalid-feedback err-login d-block">{{ loginErrors.password }}</span>
            </div>
            <div class="text-center">
              <button class="wp_btn btn-block mb-3" type="submit" :disabled="loginBusy">الدخول</button>
              <NuxtLink target="_blank" to="/forgot-password" class="wp_link" style="text-decoration: underline">نسيت كلمة المرور؟</NuxtLink>
            </div>
          </form>
        </div>
      </CartModal>

      <!-- pledge gate (legacy #agree_deal_pay_modal, ORD-09). Tick it or the payment never starts. -->
      <CartModal id="agree_deal_pay_modal" modal-class="deal_modal" :open="pledgeOpen" @close="pledgeOpen = false">
        <div class="modal-header"><h4 class="modal-title">تعهد</h4></div>
        <div class="modal-body">
          <p>
            الكتب مدفوعة الثمن المنشورة على الموقع ملكية خاصة ولهذا يتعهد من يشترى أياً من الكتب المدفوعة من الموقع بأن لا يقوم بنشره - أو جزء منه - فى أى موقع إلكترونى عام أو خاص أو فى مجموعات تطبيقات إلكترونية مثل (واتس آب)
            أو (تلجرام) أو غيرها أو منصات التواصل الإجتماعى ولا يقوم بتداوله مع أى شخص , بمقابل أو بدون مقابل
            ويتحمل الملاحقة القانونية إذا ثبت مخالفته لهذا التعهد
          </p>
          <div class="form-check">
            <label class="form-check-label">
              <input id="agree_deal_pay_input" v-model="agreed" type="checkbox" class="form-check-input">
              نعم, أتعهد وموافق على
              <NuxtLink target="_blank" to="/p/terms">سياسة الاستخدام</NuxtLink>
            </label>
          </div>
          <p id="agree_deal_pay_err" :style="{ display: showAgreeError && !agreed ? 'block' : 'none' }">من فضلك قم بالموافقة على التعهد أولاً</p>
        </div>
        <div class="modal-footer">
          <form id="agree_deal_pay_form" class="w-100 text-right" @submit.prevent="confirmPledge">
            <button type="submit" value="yes" class="btn btn-success agree_btn"><span>نعم</span> , لقد فهمت</button>
            <button type="button" value="no" class="btn btn-danger disagree_btn" @click="pledgeOpen = false">إغلاق</button>
          </form>
        </div>
      </CartModal>
    </section>
  </div>
</template>
