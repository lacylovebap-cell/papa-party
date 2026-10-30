// Injected into the page: scans visible interactive controls for overlap, touching
// neighbours, overflow and clipped text. Returns plain JSON.
window.__papaScan = function (rootSelector) {
  const root = rootSelector ? document.querySelector(rootSelector) : document;
  if (!root) return { error: 'no root ' + rootSelector };
  const vw = document.documentElement.clientWidth;
  const sel = 'button,summary,select,input:not([type=hidden]),textarea,a[href],[role=button]';
  const visible = el => {
    if (el.closest('details:not([open])') && el.tagName !== 'SUMMARY') {
      const d = el.closest('details:not([open])');
      if (!d.querySelector(':scope>summary')?.contains(el)) return false;
    }
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // skip controls behind an open modal dialog
    const dlg = document.querySelector('dialog[open]');
    if (dlg && !dlg.contains(el) && !rootSelector) return false;
    // skip decorative or intentionally invisible inputs (checkbox inside label is fine)
    return true;
  };
  const els = [...root.querySelectorAll(sel)].filter(visible);
  const label = el => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || el.name || el.type || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24);
    const box = el.closest('[class]');
    return el.tagName.toLowerCase() + '「' + t + '」' + (box ? ' in .' + String(box.className).split(' ')[0] : '');
  };
  const rect = el => el.getBoundingClientRect();
  const issues = [];
  const pushed = new Set();
  const add = (kind, a, b, extra) => {
    const key = kind + label(a) + (b ? label(b) : '');
    if (pushed.has(key)) return; pushed.add(key);
    issues.push({ kind, a: label(a), b: b ? label(b) : undefined, ...extra });
  };
  const overlay = el => !!el.closest('.queue-more[open]>.queue-more-content,.admin-more-tabs[open],.compact-main-menu[open]>.header-actions,.action-hint-popup');
  const compact = (a, b) => {
    if (a.classList.contains('action-help') || b.classList.contains('action-help')) return 'ⓘ 說明圓圈';
    if (a.closest('.queue-row') && a.closest('.queue-row') === b.closest('.queue-row')) return '待播列緊湊';
    if (a.closest('.medal-row') && (a.matches('.medal-help,.medal-replay') && b.matches('.medal-help,.medal-replay'))) return '勳章 ! ▶ 圖示';
    return null;
  };
  const related = (a, b) => a.contains(b) || b.contains(a) || (a.tagName === 'LABEL' || b.tagName === 'LABEL') ||
    (a.closest('label') && a.closest('label') === b.closest('label'));
  for (let i = 0; i < els.length; i++) {
    const a = els[i], ra = rect(a);
    // overflow outside viewport
    if (ra.right > vw + 1 || ra.left < -1) {
      // ignore controls inside an intentional horizontal scroller
      let p = a.parentElement, scroller = false;
      while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) { scroller = true; break; } p = p.parentElement; }
      if (!scroller) add('超出畫面', a, null, { right: Math.round(ra.right), vw });
    }
    // clipped text
    if (['BUTTON', 'SUMMARY'].includes(a.tagName) && a.scrollWidth > a.clientWidth + 2 && !a.classList.contains('action-help')) {
      const s = getComputedStyle(a);
      if (s.overflow !== 'visible' || s.whiteSpace === 'nowrap' || s.textOverflow === 'ellipsis') add('文字被裁切', a, null, { scroll: a.scrollWidth, client: a.clientWidth });
    }
    for (let j = i + 1; j < els.length; j++) {
      const b = els[j];
      if (related(a, b)) continue;
      const rb = rect(b);
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ix > 1 && iy > 1) { if (overlay(a) !== overlay(b)) continue; add('重疊', a, b, { px: Math.round(Math.min(ix, iy)) }); continue; }
      // same row neighbours
      const rowOverlap = iy > Math.min(ra.height, rb.height) * 0.5;
      if (rowOverlap) {
        const gap = ra.right <= rb.left ? rb.left - ra.right : ra.left - rb.right;
        if (gap >= 0 && gap < 8) {
          const ex = compact(a, b);
          if (ex && gap >= 2) add('緊湊例外', a, b, { gap: Math.round(gap * 10) / 10, rule: ex });
          else add(gap < 2 ? '相貼' : '間距不足', a, b, { gap: Math.round(gap * 10) / 10 });
        }
      }
      const colOverlap = ix > Math.min(ra.width, rb.width) * 0.5;
      if (colOverlap) {
        const gap = ra.bottom <= rb.top ? rb.top - ra.bottom : ra.top - rb.bottom;
        if (gap >= 0 && gap < 4) add(gap < 1 ? '上下相貼' : '上下間距不足', a, b, { gap: Math.round(gap * 10) / 10 });
      }
    }
  }
  const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return { count: els.length, docOverflow, issues };
};
