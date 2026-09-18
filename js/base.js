/* =========================================================
   DrawBox - base.js
   Static gallery runtime: split JSON loading, components,
   lazy images, local favorites and prompt copy.
   ========================================================= */
const App = (() => {
  // ---------- 配置 ----------
  const ASSET_VERSION = '6';
  const FAV_KEY = 'drawbox-boards-v1';
  const REC_KEY = 'drawbox-recent-v1';
  const IMAGE_CONFIG = window.DRAWBOX_CONFIG || {};
  let IMAGE_MAP = {};

  // ---------- 工具 ----------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  function imageBucket(p) {
    if (p.startsWith('images/originals/')) return 'originals';
    if (p.startsWith('images/twitter-cat1/')) return 'twitter-cat1';
    if (p.startsWith('images/twitter-cat2/')) return 'twitter-cat2';
    if (p.startsWith('images/twitter/')) return 'twitter';
    return '';
  }
  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  function resolveImage(p) {
    if (!p) return p;
    const mapped = IMAGE_MAP[p];
    if (mapped) {
      if (/^https?:\/\//i.test(mapped)) return mapped.replace(/\/$/, '') + '/' + p;
      if (IMAGE_CONFIG.pagesOrigin) return IMAGE_CONFIG.pagesOrigin.replace(/\/$/, '') + '/' + mapped.replace(/^\/|\/$/g, '') + '/' + p;
    }
    const bucket = imageBucket(p);
    const shards = bucket && IMAGE_CONFIG.imageShards ? IMAGE_CONFIG.imageShards[bucket] : null;
    if (Array.isArray(shards) && shards.length) {
      const shard = shards[hashString(p) % shards.length];
      if (/^https?:\/\//i.test(shard)) return shard.replace(/\/$/, '') + '/' + p;
      if (IMAGE_CONFIG.pagesOrigin) {
        const base = IMAGE_CONFIG.pagesOrigin.replace(/\/$/, '') + '/' + shard.replace(/^\/|\/$/g, '');
        return base.replace(/\/$/, '') + '/' + p;
      }
    }
    return p;
  }
  const imgUrl = p => resolveImage(p);

  function heartSvg(filled){
    return `<svg viewBox="0 0 24 24" fill="${filled?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M12 21s-7.5-4.6-10-9.3C.3 8.4 2 5 5.3 5c2 0 3.4 1.2 4.7 3 1.3-1.8 2.7-3 4.7-3C18 5 19.7 8.4 22 11.7 19.5 16.4 12 21 12 21z"/></svg>`;
  }

  // ---------- 主题 ----------
  const html = document.documentElement;
  function applyTheme(t){ html.setAttribute('data-theme', t); }
  function toggleTheme(){ const n = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; localStorage.setItem('drawbox-theme', n); applyTheme(n); }

  // ---------- 分类配色 ----------
  function catColor(name){
    const c = (META && META.colors && META.colors[name]) || {};
    return { bg: c.bg || '#E3F4F8', main: c.main || '#2C8CAB' };
  }

  // ---------- 状态 / 数据 ----------
  let META = null;            // { total, subCount, hot, majors, colors }
  let SAMPLES = [];           // 轻量列表（无 prompt）
  const DETAIL = {};          // id -> 完整条目（含 prompt，按需填充）
  let fullLoaded = false, fullPromise = null;
  let options = { page: null, onReady: null };
  const LIST_PARTS  = ["data/list.part1.json",  "data/list.part2.json",  "data/list.part3.json"];
  const withVersion = url => url + (url.includes('?') ? '&' : '?') + 'v=' + ASSET_VERSION;
  const FULL_PARTS  = ["data/prompts.part1.json","data/prompts.part2.json","data/prompts.part3.json"];

  function findSample(id){ return DETAIL[id] || SAMPLES.find(s => s.id == id); }

  async function loadImageMap(){
    const url = IMAGE_CONFIG.imageMapUrl || 'data/image-map.json';
    try {
      const res = await fetch(url + '?v=' + ASSET_VERSION);
      IMAGE_MAP = res.ok ? await res.json() : {};
    } catch (err) {
      IMAGE_MAP = {};
    }
  }

  async function loadData(){
    await loadImageMap();
    const meta = await (await fetch(withVersion('data/meta.json'))).json();
    META = meta;
    const parts = await Promise.all(LIST_PARTS.map(u => fetch(withVersion(u)).then(x => x.json()).catch(() => [])));
    SAMPLES = [].concat(...parts);
    SAMPLES.forEach(s => { DETAIL[s.id] = s; });
  }
  // 按需加载完整数据（含 prompt），供灯箱 / 详情 / 全文搜索使用
  function ensureFull(){
    if (fullLoaded) return Promise.resolve();
    if (fullPromise) return fullPromise;
    fullPromise = (async () => {
      const parts = await Promise.all(FULL_PARTS.map(u => fetch(withVersion(u)).then(x => x.json()).catch(() => [])));
      [].concat(...parts).forEach(e => {
        DETAIL[e.id] = e;
        const orig = SAMPLES.find(s => s.id == e.id);   // 把 prompt 回填进轻量列表，供搜索/画廊正文命中
        if (orig) orig.prompt = e.prompt;
      });
      fullLoaded = true;
      if (typeof window.__onFullLoaded === 'function') window.__onFullLoaded();
    })();
    return fullPromise;
  }

  // ---------- 组件注入 ----------
  async function injectComponent(url, selector, position = 'beforeend'){
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(url + sep + 'v=' + ASSET_VERSION);
    if (!res.ok) throw new Error('组件加载失败 ' + url);
    const htmlText = await res.text();
    const el = document.querySelector(selector);
    if (el) el.insertAdjacentHTML(position, htmlText);
  }
  async function loadComponents(){
    await Promise.all([
      injectComponent('components/header.html',   'body', 'afterbegin'),
      injectComponent('components/footer.html',   'main', 'afterend'),
      injectComponent('components/lightbox.html', 'body', 'beforeend'),
      injectComponent('components/modals.html',   'body', 'beforeend')
    ]);
  }

  function highlightNav(){
    const page = options.page;
    $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  }
  function initMobileNav(){
    const toggle = $('#navToggle'); const nav = $('#navLinks');
    if (!toggle || !nav) return;
    const setOpen = open => { toggle.classList.toggle('open', open); nav.classList.toggle('open', open); };
    toggle.addEventListener('click', e => { e.stopPropagation(); setOpen(!nav.classList.contains('open')); });
    nav.addEventListener('click', e => { const t = e.target.closest('a, button'); if (t) setOpen(false); });
    document.addEventListener('click', e => { if (nav.classList.contains('open') && !toggle.contains(e.target) && !nav.contains(e.target)) setOpen(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 920) setOpen(false); });
  }
  function wireCommon(){
    highlightNav();
    initMobileNav();
    const themeBtn = $('#themeBtn'); if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    const ns = $('#navSearchInput');
    if (ns) ns.addEventListener('keydown', e => { if (e.key === 'Enter' && ns.value.trim()) location.href = 'search.html?q=' + encodeURIComponent(ns.value.trim()); });
    // 灯箱全局事件
    const lb = $('#db-lightbox');
    if (lb){
      lb.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) closeLightbox(); });
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
  }

  // ---------- 收藏画板（localStorage） ----------
  function getBoards(){ try { return JSON.parse(localStorage.getItem(FAV_KEY)) || { boards:[{id:'default',name:'我的收藏',items:[]}], active:'default' }; } catch(e){ return { boards:[{id:'default',name:'我的收藏',items:[]}], active:'default' }; } }
  function saveBoards(b){ localStorage.setItem(FAV_KEY, JSON.stringify(b)); }
  function isFav(id){ const b = getBoards(); return b.boards.some(x => x.items.includes(id)); }
  function toggleFav(id){
    const b = getBoards(); const board = b.boards.find(x => x.id === b.active) || b.boards[0];
    const i = board.items.indexOf(id);
    if (i >= 0) board.items.splice(i, 1); else board.items.push(id);
    saveBoards(b); toast(i >= 0 ? '已从画板移除' : '已加入收藏画板'); updateFavButtons(); return i < 0;
  }
  function updateFavButtons(){ $$('.act.fav').forEach(btn => { const id = +btn.dataset.id; const on = isFav(id); btn.classList.toggle('on', on); btn.innerHTML = heartSvg(on); }); }

  // ---------- Toast & Copy ----------
  let toastEl;
  function toast(msg){ if (!toastEl){ toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); } toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1800); }
  function copyText(t){ if (navigator.clipboard){ navigator.clipboard.writeText(t).then(() => toast('提示词已复制')).catch(() => fallbackCopy(t)); } else fallbackCopy(t); }
  function fallbackCopy(t){ const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('提示词已复制'); } catch(e){} ta.remove(); }

  // ---------- 卡片渲染 ----------
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting){ const img = e.target; if (img.dataset.src){ img.src = img.dataset.src; img.removeAttribute('data-src'); } io.unobserve(img); } });
  }, { rootMargin: '300px' });

  function observeImages(c){ c.querySelectorAll('img.ph-img[data-src]').forEach(img => io.observe(img)); }

  function thumb(s){
    const category = s.category || '';
    const img = s.image;
    const { bg, main } = catColor(category);
    const hh = 180 + ((s.id || 0) % 5) * 46;
    const wm = (category || '图').slice(0, 1);
    const hint = '<span class="load-hint">原图加载中，首次打开请稍候…</span>';
    const inner = img
      ? `${hint}<img class="ph-img" data-src="${esc(imgUrl(img))}" alt="${esc(category)}" onload="this.previousElementSibling?.remove()" onerror="this.previousElementSibling?.remove();this.style.display='none'">`
      : `<span class="wm">${esc(wm)}</span>`;
    return `<div class="ph" style="height:${hh}px;background:linear-gradient(140deg,${bg} 0%,${main} 135%);">${inner}</div>`;
  }

  function cardHTML(s){
    const { main } = catColor(s.category);
    return `<article class="card" data-id="${s.id}">
      <a class="thumb" href="detail.html?id=${s.id}" style="--cc:${main}">
        ${thumb(s)}
        <span class="cat-pill" style="--cc:${main}">${esc(s.category)}</span>
        <span class="hover-actions">
          <button class="act fav ${isFav(s.id) ? 'on' : ''}" data-id="${s.id}" title="收藏">${heartSvg(isFav(s.id))}</button>
          <button class="act" data-copy="${s.id}" title="复制提示词"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke-linecap="round"/></svg></button>
        </span>
      </a>
      <div class="body">
        <a class="title" href="detail.html?id=${s.id}">${esc(s.title)}</a>
        <div class="prompt-line">${esc(s.prompt || '')}</div>
      </div>
    </article>`;
  }

  function renderCards(list, container){
    if (!container) return;
    if (!list.length){ container.innerHTML = '<div class="empty"><div class="big">🌱</div>没有匹配的提示词，换个关键词或分类试试。</div>'; return; }
    container.innerHTML = list.map(cardHTML).join('');
    observeImages(container);
    container.querySelectorAll('.act.fav').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleFav(+b.dataset.id); }));
    container.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); const s = findSample(+b.dataset.copy); copyText(s ? s.prompt : ''); }));
  }

  // 12 大分类卡片
  const MAJ_EMOJI = {'（大凶）':'🔥','人物写真':'👤','其他/未归类':'🗂️','随手拍':'📸','动漫二次元':'🌸','产品电商':'🛍️','海报广告':'🖼️','插画艺术':'🎨','车辆机械3D':'🚗','游戏':'🎮','建筑空间场景':'🏛️','晓兰':'🌿'};
  function renderCategories(container){
    if (!container || !META) return;
    container.innerHTML = META.majors.map(m => {
      const { bg, main } = catColor(m.name);
      const subs = m.subs.slice(0, 4).map(s => `<span>${esc(s.name)}</span>`).join('') + (m.subs.length > 4 ? `<span class="more">+${m.subs.length - 4}</span>` : '');
      return `<a class="cat-card" href="gallery.html?cat=${encodeURIComponent(m.name)}" style="--cc:${main};--cc-bg:${bg}">
        <div class="ctop">
          <span class="cico" style="--cc-bg:${bg}">${MAJ_EMOJI[m.name] || '📁'}</span>
          <div><h3>${esc(m.name)}</h3><div class="ccount">${m.count} 条 · ${m.subs.length} 小类</div></div>
        </div>
        <div class="subs">${subs}</div>
        <span class="arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </a>`;
    }).join('');
  }

  // ---------- 灯箱（完整显示整图） ----------
  function buildLightbox(){
    let lb = document.getElementById('db-lightbox');
    if (lb) return lb;
    lb = document.createElement('div'); lb.className = 'lightbox'; lb.id = 'db-lightbox';
    lb.innerHTML = `<div class="lb-backdrop" data-close></div>
      <div class="lb-panel"><button class="lb-close" data-close aria-label="关闭">✕</button>
        <div class="lb-img" id="lbImg"></div>
        <div class="lb-body" id="lbBody"></div>
      </div>`;
    document.body.appendChild(lb);
    return lb;
  }
  function openLightbox(id){
    const s = findSample(id); if (!s) return;
    const lb = buildLightbox();
    const { bg, main } = catColor(s.category);
    const lbImg = $('#lbImg');
    const hint = '<span class="load-hint">原图加载中，首次打开请稍候…</span>';
    const fallback = `<div class="ph" style="background:linear-gradient(140deg,${bg},${main})"></div><span class="wm">${esc((s.category || '图').slice(0,1))}</span>`;
    if (s.image){
      lbImg.innerHTML = `${hint}<img class="ph-img" src="${esc(imgUrl(s.image))}" alt="${esc(s.category)}">`;
      const im = lbImg.querySelector('img');
      im.addEventListener('load', () => { const h = lbImg.querySelector('.load-hint'); if (h) h.remove(); });
      im.addEventListener('error', () => { lbImg.innerHTML = fallback; });
      if (im.complete && im.naturalWidth){ const h = lbImg.querySelector('.load-hint'); if (h) h.remove(); }
    } else {
      lbImg.innerHTML = fallback;
    }
    const tokPrompt = esc(s.prompt || '（加载中…）').replace(/(\{argument[^}]*\})/g, '<span class="tok">$1</span>');
    $('#lbBody').innerHTML = `
      <div class="lb-crumb"><a href="gallery.html">画廊</a> › <a href="gallery.html?cat=${encodeURIComponent(s.category)}" style="--cc:${main}">${esc(s.category)}</a></div>
      <h2 class="lb-title">${esc(s.title)}</h2>
      <div class="lb-tags"><span class="tag cc" style="--cc:${main};--cc-bg:${bg}">${esc(s.category)}</span><span class="tag">ID #${s.id}</span></div>
      <div class="lb-prompt" id="lbPrompt">${tokPrompt}</div>
      <div class="lb-actions">
        <button class="btn btn-primary" id="lbCopy">复制提示词</button>
        <button class="btn btn-soft fav-btn ${isFav(s.id) ? 'on' : ''}" data-id="${s.id}">${heartSvg(isFav(s.id))} 收藏</button>
        <button class="btn btn-soft" data-copy="${s.id}">复制原文</button>
      </div>`;
    $('#lbCopy').addEventListener('click', () => copyText(s.prompt || ''));
    $('#lbBody').querySelector('.fav-btn').addEventListener('click', function(){ const on = toggleFav(s.id); this.classList.toggle('on', on); this.innerHTML = heartSvg(on) + (on ? ' 已收藏' : ' 收藏'); updateFavButtons(); });
    $('#lbBody').querySelector('[data-copy]').addEventListener('click', () => copyText(s.prompt || ''));
    // 轻量数据无 prompt：按需补齐
    if (!s.prompt){
      ensureFull().then(() => { const f = findSample(id); if (f && f.prompt && lb.classList.contains('open')){ const tk = esc(f.prompt).replace(/(\{argument[^}]*\})/g, '<span class="tok">$1</span>'); const p = $('#lbPrompt'); if (p) p.innerHTML = tk; } });
    }
    lb.classList.add('open'); document.body.style.overflow = 'hidden';
  }
  function closeLightbox(){ const lb = document.getElementById('db-lightbox'); if (lb){ lb.classList.remove('open'); document.body.style.overflow = ''; } }

  // ---------- 初始化 ----------
  function init(opts){
    options = Object.assign({ page: null, onReady: null }, opts);
    applyTheme(localStorage.getItem('drawbox-theme') || 'light');
    loadComponents()
      .then(wireCommon)
      .then(loadData)
      .then(() => { if (typeof options.onReady === 'function') options.onReady(); })
      .catch(err => { console.error(err); const l = document.querySelector('.loading'); if (l) l.textContent = '数据加载失败：' + err.message + '（请通过本地 HTTP 服务器打开本页）'; });
  }

  // ---------- 暴露 API ----------
  return {
    init,
    get D(){ return { majors: META ? META.majors : [], samples: SAMPLES, colors: META ? META.colors : {}, total: META ? META.total : SAMPLES.length, subCount: META ? META.subCount : 0, hot: META ? META.hot : [] }; },
    get ALL(){ return SAMPLES; },
    IMAGE_CONFIG, ASSET_VERSION,
    $, $$, imgUrl,
    findSample, catColor, thumb, cardHTML, renderCards, renderCategories,
    openLightbox, closeLightbox, ensureFull,
    toggleFav, isFav, toast, copyText, getBoards, saveBoards
  };
})();

window.App = App;
window.$   = App.$;
window.$$  = App.$$;

// 全局：点卡片（非链接/非按钮）唤起灯箱
document.addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (card && !e.target.closest('a') && !e.target.closest('.act')){
    App.openLightbox(+card.dataset.id);
  }
});





