// Behaviour layer for the preserved legacy markup (Bootstrap-4 data-API: dropdown, collapse, tabs/pills, modal,
// alert dismiss, admin sidebar toggle). Re-implemented from scratch with event delegation so the original
// class names / data-* attributes keep working without jQuery or the legacy JS bundle.
// Derived from ui-reference/assets/js/ref.js (own code, no legacy script executed).
export default defineNuxtPlugin(() => {
  const d = document

  const closest = (el: EventTarget | null, sel: string): HTMLElement | null => {
    let n = el as Node | null
    while (n && n.nodeType === 1) {
      if ((n as HTMLElement).matches(sel)) return n as HTMLElement
      n = n.parentNode
    }
    return null
  }

  const closeMenus = () => {
    d.querySelectorAll('.dropdown-menu.show').forEach((m) => {
      m.classList.remove('show')
      m.parentElement?.classList.remove('show')
    })
  }
  const openModal = (m: HTMLElement) => {
    m.style.display = 'block'
    m.classList.add('show')
    const b = d.createElement('div')
    b.className = 'modal-backdrop show'
    b.setAttribute('data-aw-backdrop', '')
    d.body.appendChild(b)
    d.body.classList.add('modal-open')
  }
  const closeModal = (m: HTMLElement | null) => {
    if (!m) return
    m.classList.remove('show')
    m.style.display = 'none'
    d.querySelectorAll('[data-aw-backdrop]').forEach((b) => b.remove())
    d.body.classList.remove('modal-open')
  }

  d.addEventListener('click', (e) => {
    const t = closest(e.target, '[data-toggle="dropdown"]')
    if (t) {
      e.preventDefault()
      const menu = t.parentElement?.querySelector('.dropdown-menu')
      if (menu) {
        const wasOpen = menu.classList.contains('show')
        closeMenus()
        if (!wasOpen) { menu.classList.add('show'); t.parentElement?.classList.add('show') }
      }
      return
    }
    if (!closest(e.target, '.dropdown-menu')) closeMenus()

    const c = closest(e.target, '[data-toggle="collapse"]')
    if (c) {
      e.preventDefault()
      const sel = c.getAttribute('data-target') || c.getAttribute('href')
      const target = sel ? d.querySelector<HTMLElement>(sel) : null
      if (target) {
        const parentSel = target.getAttribute('data-parent')
        if (parentSel && !target.classList.contains('show')) {
          d.querySelectorAll(`${parentSel} .collapse.show`).forEach((o) => { if (o !== target) o.classList.remove('show') })
        }
        const shown = target.classList.toggle('show')
        c.setAttribute('aria-expanded', shown ? 'true' : 'false')
      }
      return
    }

    const tab = closest(e.target, '[data-toggle="tab"],[data-toggle="pill"]')
    if (tab) {
      e.preventDefault()
      const sel = tab.getAttribute('data-target') || tab.getAttribute('href')
      const pane = sel ? d.querySelector<HTMLElement>(sel) : null
      if (pane) {
        closest(tab, '.nav, nav, ul')?.querySelectorAll('.nav-link').forEach((a) => a.classList.remove('active'))
        tab.classList.add('active')
        pane.parentElement?.querySelectorAll(':scope > .tab-pane').forEach((p) => p.classList.remove('active', 'show'))
        pane.classList.add('active', 'show')
      }
      return
    }

    const mo = closest(e.target, '[data-toggle="modal"]')
    if (mo) {
      e.preventDefault()
      const sel = mo.getAttribute('data-target') || mo.getAttribute('href')
      const m = sel && sel.startsWith('#') ? d.querySelector<HTMLElement>(sel) : null
      if (m) openModal(m)
      return
    }
    const dm = closest(e.target, '[data-dismiss="modal"]')
    if (dm) { closeModal(closest(dm, '.modal')); return }
    if ((e.target as HTMLElement).classList?.contains('modal')) closeModal(e.target as HTMLElement)

    const da = closest(e.target, '[data-dismiss="alert"]')
    if (da) { closest(da, '.alert')?.remove(); return }

    // admin sidebar toggle (legacy: #button-toggle toggles .wrapper.slide-menu)
    if (closest(e.target, '#button-toggle')) {
      e.preventDefault()
      d.querySelector('.wrapper')?.classList.toggle('slide-menu')
    }
  })

  // admin sidebar: hover expands the collapsed (icon-only) menu (legacy custom.js behaviour)
  d.addEventListener('mouseover', (e) => {
    if (closest(e.target, '.side-menu-fixed')) d.querySelector('.wrapper')?.classList.add('sidebar-hover')
  })
  d.addEventListener('mouseout', (e) => {
    const to = (e as MouseEvent).relatedTarget
    if (closest(e.target, '.side-menu-fixed') && !closest(to, '.side-menu-fixed')) {
      d.querySelector('.wrapper')?.classList.remove('sidebar-hover')
    }
  })
})
