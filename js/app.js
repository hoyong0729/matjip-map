/* 맛도리 (유튜버가 다녀간 맛집 지도) — 빌드 도구 없는 정적 웹앱.
 * 데이터: data/restaurants.json (python -m matjip export)
 * 지도:   카카오맵 JavaScript SDK (config.js 의 kakaoJsKey, services·clusterer 라이브러리)
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------- 상수
  const CATEGORIES = ["한식", "중식", "일식", "양식", "아시안", "분식", "술집", "카페·디저트", "기타", "미분류"];
  const COLORS = {
    "한식": "#e5484d", "중식": "#e8a317", "일식": "#2f6fdb", "양식": "#8e4ec6", "아시안": "#12a594",
    "분식": "#e5498f", "술집": "#0d8fb0", "카페·디저트": "#a0662b", "기타": "#5b6470", "미분류": "#a3aab3",
  };
  const MOBILE = window.matchMedia("(max-width: 768px)");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ytThumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;   // 16:9, 검은 띠 없음

  const state = {
    all: [],
    q: "",
    cats: new Set(),
    channels: new Set(), // 채널(프로그램) 여러 개 선택. 비면 전체
    subset: null,        // 클러스터를 최대로 확대해도 안 펼쳐질 때(같은 건물) 그 식당 id 들만 목록에
    routeMode: "public", // 길찾기 이동수단: public(대중교통) / walk(도보) / car(자동차)
    region: "",          // "서울" 또는 "서울|중구", "" = 전체
    view: "map",
    near: null,          // { lat, lon, label, query } — 검색한 장소 주변
    radiusKm: 1,
    // 내 위치: 이 탭의 메모리에만 둔다. 저장(localStorage 등)하거나 어디로도 보내지 않는다.
    me: null,            // { lat, lon }
    meRadiusKm: 0,       // 0 = 전체 (가까운 순 정렬만)
    geoNoticeShown: false,
    selected: null,
    // 모바일 시트: closed(손잡이와 'N곳' 한 줄만) / half / full.
    // 사용자가 접으면 그대로 둔다. 다시 여는 건 ① 핀 탭(상세 반만) ② 접힌 바 탭·끌어올리기 ③ 검색 실행 뿐
    sheet: "closed",
  };

  const el = {
    app: $("app"), topbar: $("topbar"), panel: $("panel"), list: $("list"), empty: $("empty"),
    count: $("count"), sortLabel: $("sortLabel"), detail: $("detail"), scroll: $("scroll"),
    q: $("q"), qClear: $("qClear"), form: $("searchForm"), nearSuggest: $("nearSuggest"),
    nearBar: $("nearBar"), nearLabel: $("nearLabel"), nearClear: $("nearClear"), radius: $("radius"),
    region: $("region"), chips: $("chips"), viewSeg: $("viewSeg"),
    updated: $("updated"), mapMessage: $("mapMessage"), grip: $("sheetGrip"), listMeta: $("listMeta"),
    locate: $("locateBtn"), meRadius: $("meRadius"), toast: $("toast"),
    channelBtn: $("channelBtn"), channelPop: $("channelPop"), channelLabel: $("channelLabel"),
    subsetClear: $("subsetClear"),
    installBar: $("installBar"), installText: $("installText"), installGo: $("installGo"), installClose: $("installClose"),
  };

  // ---------------------------------------------------------------- 유틸
  function distanceKm(aLat, aLon, bLat, bLon) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10}m` : `${km.toFixed(1)}km`);
  const programsOf = (r) => [...new Set(r.videos.map((v) => v.program).filter(Boolean))];
  const latestDate = (r) => r.videos.reduce((m, v) => (v.date > m ? v.date : m), "");
  // 설명란에서 확정한 식당(먹을텐데 등)과 구분: 여러 증거로 자동 매칭한 식당에만 작은 배지
  const autoBadge = (r) => (r.source === "자동매칭"
    ? `<span class="badge badge-auto" title="설명란에 주소가 없어 블로그·카카오 장소 검색 증거로 찾은 식당">자동 매칭</span>` : "");
  // 지역 검색(채널이 아니라 지역 검색어로 찾은 영상): 채널 필터에서는 '지역 검색' 하나로 묶고, 카드·상세에는 실제 채널명
  const REGION_PROGRAM = "지역 검색";
  const regionChannels = (r) => [...new Set(r.videos.filter((v) => v.program === REGION_PROGRAM).map((v) => v.channel).filter(Boolean))];
  const regionBadge = `<span class="badge badge-region" title="채널이 아니라 지역 검색어로 찾은 영상에서 여러 증거로 찾은 식당">지역 검색</span>`;
  const videoSource = (v) => (v.program === REGION_PROGRAM ? `${v.channel || "유튜브"} · ${REGION_PROGRAM}` : v.program);
  // 영상의 지원·광고 표기 (export 가 자동매칭·지역검색 연결에만 넣음): 지자체·기관 지원 제작 / 업체 유료광고·협찬
  const AD_LABEL = { "지원": "지원 영상", "광고": "광고 영상" };
  const AD_TITLE = { "지원": "지자체·기관의 지원을 받아 만든 영상", "광고": "업체의 유료광고·협찬이 포함된 영상" };
  const adBadge = (k) => `<span class="badge badge-ad" title="${AD_TITLE[k]}">${AD_LABEL[k]}</span>`;
  const adBadges = (r) => ["지원", "광고"].filter((k) => r.videos.some((v) => v.ad === k)).map(adBadge).join("");
  const naverSearch = (r) => `https://map.naver.com/p/search/${encodeURIComponent(`${r.name} ${r.subregion || r.region}`)}`;

  // ---------------------------------------------------------------- 길찾기 (휴대폰: 앱 바로, 없으면 웹 / PC: 웹)
  // 카카오맵: kakaomap://route?sp=위도,경도&ep=위도,경도&by=car|publictransit|foot (KakaoMapsSDK URL Scheme 문서)
  //           앱 없으면 모바일웹 m.map.kakao.com/scheme/route (같은 문서), PC 는 map.kakao.com/link/… (지도 웹 가이드)
  // 네이버:   nmap://route/{public|walk|car}?dlat&dlng&dname&appname (NCP Maps URL Scheme 문서, appname 필수)
  //           공식 웹 길찾기 URL 은 문서에 없어 앱이 없거나 PC 면 네이버지도 웹에서 그 식당을 연다
  const ROUTE = {
    public: { label: "대중교통", kakaoApp: "publictransit", kakaoWeb: "traffic", naver: "public" },
    walk: { label: "도보", kakaoApp: "foot", kakaoWeb: "walk", naver: "walk" },
    car: { label: "자동차", kakaoApp: "car", kakaoWeb: "car", naver: "car" },
  };

  function deviceKind() {
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) return "android";
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    return "pc";
  }

  function routeLinks(app, r, mode = state.routeMode, me = state.me, device = deviceKind()) {
    const m = ROUTE[mode] || ROUTE.public;
    const name = encodeURIComponent(r.name);
    if (app === "kakao") {
      const qs = (me ? `sp=${me.lat},${me.lon}&` : "") + `ep=${r.lat},${r.lon}&by=${m.kakaoApp}`;
      const web = me
        ? `https://map.kakao.com/link/by/${m.kakaoWeb}/${encodeURIComponent("내 위치")},${me.lat},${me.lon}/${name},${r.lat},${r.lon}`
        : `https://map.kakao.com/link/to/${name},${r.lat},${r.lon}`;
      const mobileWeb = me ? `http://m.map.kakao.com/scheme/route?${qs}` : web;
      if (device === "pc") return { url: web };
      if (device === "android") {
        return { url: `intent://route?${qs}#Intent;scheme=kakaomap;package=net.daum.android.map;`
                      + `S.browser_fallback_url=${encodeURIComponent(mobileWeb)};end` };
      }
      return { url: `kakaomap://route?${qs}`, fallback: mobileWeb };
    }
    const appname = encodeURIComponent(location.origin + location.pathname);   // 네이버: 호출한 사이트를 appname 으로
    const start = me ? `slat=${me.lat}&slng=${me.lon}&sname=${encodeURIComponent("내 위치")}&` : "";
    const qs = `${start}dlat=${r.lat}&dlng=${r.lon}&dname=${name}&appname=${appname}`;
    const web = naverSearch(r);
    if (device === "pc") return { url: web };
    if (device === "android") {
      return { url: `intent://route/${m.naver}?${qs}#Intent;scheme=nmap;action=android.intent.action.VIEW;`
                    + `category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;`
                    + `S.browser_fallback_url=${encodeURIComponent(web)};end` };
    }
    return { url: `nmap://route/${m.naver}?${qs}`, fallback: web };
  }

  function openRoute(app, r) {
    const { url, fallback } = routeLinks(app, r);
    if (deviceKind() === "pc") { window.open(url, "_blank", "noopener"); return; }
    // iOS: 앱을 부르고 1.5초 뒤에도 이 화면이 보이면 앱이 없는 것 → 웹으로 (안드로이드는 intent 의 fallback 이 처리)
    const t = Date.now();
    location.href = url;
    if (fallback) {
      setTimeout(() => { if (!document.hidden && Date.now() - t < 2500) location.href = fallback; }, 1500);
    }
  }

  // ---------------------------------------------------------------- 필터
  function matchesBase(r) {
    if (state.cats.size && !state.cats.has(r.category)) return false;
    if (state.channels.size && !r.videos.some((v) => state.channels.has(v.program))) return false;
    if (state.region) {
      const [reg, sub] = state.region.split("|");
      if (r.region !== reg) return false;
      if (sub && r.subregion !== sub) return false;
    }
    return true;
  }

  // 거리 기준점: 검색한 장소가 있으면 그곳, 없으면 내 위치
  const origin = () => state.near || state.me;
  const distFrom = (r) => {
    const o = origin();
    return o && r.lat != null ? distanceKm(o.lat, o.lon, r.lat, r.lon) : null;
  };

  function visible() {
    const q = state.q.trim().toLowerCase();
    let rows = state.all.filter(matchesBase);
    if (state.subset) rows = rows.filter((r) => state.subset.has(r.id));   // 같은 건물 클러스터
    if (!state.near && q) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
    }
    if (!origin()) {
      return rows.sort((a, b) => latestDate(b).localeCompare(latestDate(a)) || a.name.localeCompare(b.name));
    }
    const limit = state.near ? state.radiusKm : state.meRadiusKm;   // 0 = 전체
    return rows
      .map((r) => ({ ...r, _dist: distFrom(r) }))
      .filter((r) => !limit || (r._dist != null && r._dist <= limit))
      .sort((a, b) => (a._dist ?? Infinity) - (b._dist ?? Infinity));
  }

  // ---------------------------------------------------------------- 필터 UI
  function renderRegionOptions() {
    const byRegion = new Map();
    for (const r of state.all) {
      if (!byRegion.has(r.region)) byRegion.set(r.region, new Map());
      const subs = byRegion.get(r.region);
      subs.set(r.subregion, (subs.get(r.subregion) || 0) + 1);
    }
    const regions = [...byRegion.entries()]
      .map(([reg, subs]) => [reg, subs, [...subs.values()].reduce((a, b) => a + b, 0)])
      .sort((a, b) => b[2] - a[2]);
    let html = `<option value="">전체 지역 (${state.all.length})</option>`;
    for (const [reg, subs, n] of regions) {
      html += `<optgroup label="${esc(reg)}"><option value="${esc(reg)}">${esc(reg)} 전체 (${n})</option>`;
      for (const [sub, m] of [...subs.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"))) {
        if (sub) html += `<option value="${esc(reg)}|${esc(sub)}">${esc(reg)} ${esc(sub)} (${m})</option>`;
      }
      html += `</optgroup>`;
    }
    el.region.innerHTML = html;
  }

  function renderChips() {
    const counts = {};
    for (const r of state.all) counts[r.category] = (counts[r.category] || 0) + 1;
    const present = CATEGORIES.filter((c) => counts[c]);
    el.chips.innerHTML =
      `<button type="button" class="chip" data-cat="" aria-pressed="${state.cats.size === 0}">전체</button>` +
      present.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" style="--c:${COLORS[c]}"
          aria-pressed="${state.cats.has(c)}"><span class="dot"></span>${esc(c)}<span class="n">${counts[c]}</span></button>`).join("");
  }

  // 채널(프로그램) 목록: 데이터에 있는 프로그램을 자동으로 (새 채널이 들어오면 저절로 생김)
  function renderChannels() {
    const counts = new Map();
    for (const r of state.all) for (const p of programsOf(r)) counts.set(p, (counts.get(p) || 0) + 1);
    const names = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, "ko"));
    el.channelPop.innerHTML =
      `<button type="button" class="ch-item" data-ch="" aria-pressed="${state.channels.size === 0}">전체 채널</button>` +
      names.map((n) => `<button type="button" class="ch-item" data-ch="${esc(n)}" aria-pressed="${state.channels.has(n)}">`
        + `<span class="ch-check" aria-hidden="true"></span>${esc(n)}<span class="n">${counts.get(n)}</span></button>`).join("");
    const sel = [...state.channels];
    el.channelLabel.textContent = sel.length === 0 ? "채널" : sel.length === 1 ? sel[0] : `채널 ${sel.length}`;
    el.channelBtn.classList.toggle("is-on", sel.length > 0);
  }

  function toggleChannelPop(open = el.channelPop.hidden) {
    el.channelPop.hidden = !open;
    el.channelBtn.setAttribute("aria-expanded", String(open));
  }

  function renderNear() {
    const text = el.q.value.trim();
    el.qClear.hidden = !text;
    el.nearBar.hidden = !state.near;
    el.nearSuggest.hidden = !text || !!state.near || !mapReady();
    if (!el.nearSuggest.hidden) {
      el.nearSuggest.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>‘${esc(text)}’ 주변 맛집 찾기`;
    }
    if (state.near) {
      el.nearLabel.textContent = `${state.near.label} 주변`;
      for (const b of el.radius.querySelectorAll("button")) b.setAttribute("aria-checked", String(+b.dataset.km === state.radiusKm));
    }
  }

  // ---------------------------------------------------------------- 목록
  function cardHTML(r) {
    const progs = programsOf(r);
    const dist = r._dist != null ? `<span class="sep"></span><span class="dist">${fmtDist(r._dist)}</span>` : "";
    const thumb = r.videos[0] ? ytThumb(r.videos[0].id) : r.thumb;
    return `<li class="card${state.selected === r.id ? " is-active" : ""}" data-id="${r.id}" tabindex="0">
      <div class="thumb"><img loading="lazy" src="${esc(thumb)}" alt=""><span class="play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span></div>
      <div class="info">
        <h3>${esc(r.name)}</h3>
        <div class="meta"><span class="cat" style="--c:${COLORS[r.category] || COLORS["기타"]}">${esc(r.category)}</span>
          <span>${esc(r.hood || r.region)}</span>${dist}</div>
        <div class="badges">${progs.filter((p) => p !== REGION_PROGRAM).map((p) => `<span class="badge badge-prog">${esc(p)}</span>`).join("")}${
          regionChannels(r).map((c) => `<span class="badge badge-prog">${esc(c)}</span>`).join("")}${
          progs.includes(REGION_PROGRAM) ? regionBadge : ""}${autoBadge(r)}${adBadges(r)}${
          r.videos.length > 1 ? `<span class="badge-count">영상 ${r.videos.length}개</span>` : ""}</div>
      </div></li>`;
  }

  function render({ fit = false } = {}) {
    const rows = visible();
    el.count.textContent = rows.length;
    el.sortLabel.textContent = state.subset ? "같은 위치"
      : state.near ? "가까운 순" : state.me ? "내 위치에서 가까운 순" : "최신 영상 순";
    el.subsetClear.hidden = !state.subset;
    el.meRadius.hidden = !state.me || !!state.near || !!state.subset;
    el.sortLabel.hidden = !el.meRadius.hidden && MOBILE.matches;     // 모바일은 좁아서 반경 버튼만
    for (const b of el.meRadius.querySelectorAll("button")) {
      b.setAttribute("aria-checked", String(+b.dataset.km === state.meRadiusKm));
    }
    el.locate.classList.toggle("is-on", !!state.me && !state.near);
    el.list.innerHTML = rows.map(cardHTML).join("");
    el.empty.hidden = rows.length > 0;
    for (const b of el.chips.querySelectorAll(".chip")) {
      const c = b.dataset.cat;
      b.setAttribute("aria-pressed", String(c ? state.cats.has(c) : state.cats.size === 0));
    }
    renderNear();
    drawMarkers(rows, fit);
  }

  // ---------------------------------------------------------------- 상세
  function openDetail(id, { pan = true } = {}) {
    const base = state.all.find((r) => r.id === id);
    if (!base) return;
    const r = { ...base, _dist: distFrom(base) };
    state.selected = id;
    const dist = r._dist != null ? `<span class="sep"></span><span class="dist">${fmtDist(r._dist)}</span>` : "";
    el.detail.innerHTML = `
      <button type="button" class="back" data-action="back">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6"/></svg>목록</button>
      <div class="hero"><img src="${esc(r.videos[0] ? ytThumb(r.videos[0].id) : r.thumb)}" alt=""></div>
      <h2>${esc(r.name)}</h2>
      <div class="meta"><span class="cat" style="--c:${COLORS[r.category] || COLORS["기타"]}">${esc(r.category)}</span>
        <span>${esc(r.hood || r.region)}</span>${dist}${autoBadge(r)}${programsOf(r).includes(REGION_PROGRAM) ? regionBadge : ""}${adBadges(r)}</div>
      <p class="addr"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>
        <span>${esc(r.address)}</span><button type="button" class="copy" data-action="copy">복사</button></p>
      ${r.lat != null ? `
      <div class="route-mode" role="radiogroup" aria-label="이동수단">${Object.entries(ROUTE).map(([k, m]) =>
        `<button type="button" data-action="mode" data-mode="${k}" aria-checked="${state.routeMode === k}">${m.label}</button>`).join("")}
      </div>
      <div class="actions">
        <button type="button" class="btn btn-kakao" data-action="route" data-app="kakao">카카오맵 길찾기</button>
        <button type="button" class="btn btn-naver" data-action="route" data-app="naver">네이버지도 길찾기</button>
      </div>` : `
      <div class="actions"><a class="btn btn-naver" href="${naverSearch(r)}" target="_blank" rel="noopener">네이버지도에서 보기</a></div>`}
      <h4 class="section-title">나온 영상 <span class="yt">${r.videos.length}</span></h4>
      <ul class="videos">${r.videos.map((v) => `
        <li><a class="video" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener">
          <div class="thumb"><img loading="lazy" src="${ytThumb(v.id)}" alt=""></div>
          <div><b>${esc(v.title)}</b><span>${esc(videoSource(v))} · ${esc(v.date)}${v.ad ? ` ${adBadge(v.ad)}` : ""}</span></div></a></li>`).join("")}
      </ul>`;
    el.detail.hidden = false;
    el.scroll.hidden = true;
    el.listMeta.hidden = true;            // 모바일에서는 위 손잡이(sheet-grip)로 시트를 끌 수 있다
    el.detail.scrollTop = 0;
    for (const c of el.list.querySelectorAll(".card")) c.classList.toggle("is-active", +c.dataset.id === id);
    highlightPin(id);
    if (MOBILE.matches) setSheet("half");
    if (pan && map && r.lat != null) focusOn(r);
  }

  function closeDetail() {
    state.selected = null;
    el.detail.hidden = true;
    el.scroll.hidden = false;
    el.listMeta.hidden = false;
    highlightPin(null);
    for (const c of el.list.querySelectorAll(".card.is-active")) c.classList.remove("is-active");
  }

  // ---------------------------------------------------------------- 지도 (카카오)
  let map = null, clusterer = null, nearOverlay = null, nearCircle = null, meOverlay = null, meCircle = null;
  const pins = new Map();         // id → { overlay, node }
  let labelOverlay = null;
  const mapReady = () => !!(map && window.kakao?.maps?.services);

  function loadKakao(key) {
    return new Promise((resolve, reject) => {
      if (!key) return reject(new Error("nokey"));
      const s = document.createElement("script");
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services,clusterer`;
      s.onload = () => (window.kakao?.maps ? kakao.maps.load(resolve) : reject(new Error("sdk")));
      s.onerror = () => reject(new Error("load"));
      document.head.appendChild(s);
    });
  }

  function initMap() {
    const K = kakao.maps;
    map = new K.Map(document.getElementById("map"), { center: new K.LatLng(36.4, 127.8), level: 12 });
    map.setMaxLevel(13);
    // 확대/축소: 기본 컨트롤 대신 화면 디자인에 맞춘 버튼 (모바일은 두 손가락으로)
    const zoom = document.getElementById("zoom");
    zoom.hidden = false;
    zoom.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-zoom]");
      if (b) map.setLevel(map.getLevel() + +b.dataset.zoom, { animate: true });
    });
    // 도시 단위 이상으로 멀리 볼 때만 핀을 묶는다 (동네 단위에서는 핀이 하나씩 보여야 고르기 쉽다)
    clusterer = new K.MarkerClusterer({
      map, averageCenter: true, minLevel: 8, gridSize: 56, minClusterSize: 3,
      disableClickZoom: true,            // 기본 확대(한 단계) 대신 clusterclick 에서 직접 처리
      calculator: [10, 30],
      styles: [0, 1, 2].map((i) => ({
        width: `${40 + i * 8}px`, height: `${40 + i * 8}px`, lineHeight: `${40 + i * 8}px`,
        background: "rgba(255, 90, 31, .92)", color: "#fff", textAlign: "center", fontWeight: "800",
        fontSize: "14px", borderRadius: "50%", border: "3px solid #fff",
        boxShadow: "0 2px 8px rgba(0,0,0,.25)", fontFamily: "Pretendard Variable, sans-serif",
      })),
    });
    K.event.addListener(clusterer, "clusterclick", onClusterTap);
    // 지도 빈 곳을 탭하면 시트를 접는다. 카카오 'click' 은 터치에서 안 오는 경우가 있어
    // 지도 영역의 짧은 탭(거의 안 움직이고 0.4초 안에 뗌)을 직접 감지한다. 핀·버튼을 탭한 경우는 제외
    const collapse = () => { if (MOBILE.matches && state.sheet !== "closed") setSheet("closed"); };
    K.event.addListener(map, "click", collapse);
    const mapEl = document.getElementById("map");
    let down = null;
    mapEl.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
    mapEl.addEventListener("pointerup", (e) => {
      if (!down) return;
      const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && Date.now() - down.t < 400;
      down = null;
      if (tap && !e.target.closest(".pin, .pin-label, .me-dot, .here, button")) collapse();
    }, true);
  }

  function pinNode(r) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pin";
    b.style.setProperty("--c", COLORS[r.category] || COLORS["기타"]);
    b.setAttribute("aria-label", `${r.name} (${r.category})`);
    b.addEventListener("click", (e) => { e.stopPropagation(); onPinTap(r); });
    return b;
  }

  // 클러스터(숫자 원) 탭: 그 구역으로 부드럽게 확대해 핀을 펼친다. 클러스터는 레벨 8 이상에서만 묶이므로
  // 레벨 7 로 내려가면 개별 핀이 된다. 다만 모두 같은 건물(약 30m 안)이면 확대해도 핀이 겹치므로 목록으로 보여준다
  const overlayId = new WeakMap();
  const SAME_PLACE_DEG = 0.0003;
  function onClusterTap(cluster) {
    const K = kakao.maps;
    const ids = cluster.getMarkers().map((o) => overlayId.get(o)).filter((x) => x != null);
    const rows = state.all.filter((r) => ids.includes(r.id));
    const lats = rows.map((r) => r.lat), lons = rows.map((r) => r.lon);
    const samePlace = rows.length > 1 && Math.max(...lats) - Math.min(...lats) < SAME_PLACE_DEG
      && Math.max(...lons) - Math.min(...lons) < SAME_PLACE_DEG;
    // 목표 레벨: 클러스터 식당들이 퍼진 범위가 화면의 약 70% 를 채우는 레벨 (레벨이 1 줄면 2배 확대).
    // 한 번에 부드럽게 그 레벨로 간다. 큰 클러스터는 작은 클러스터로 나뉘고, 작은 클러스터는 개별 핀으로 펼쳐진다
    const level = map.getLevel();
    let target = 3;
    if (!samePlace) {
      const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
      const cos = Math.cos(cluster.getCenter().getLat() * Math.PI / 180);
      const viewSpan = Math.min(ne.getLat() - sw.getLat(), (ne.getLng() - sw.getLng()) * cos);
      const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lons) - Math.min(...lons)) * cos, 0.002);
      const steps = Math.floor(Math.log2((viewSpan * 0.7) / span));
      target = Math.max(1, level - Math.max(1, steps));
    }
    const center = new K.LatLng((Math.max(...lats) + Math.min(...lats)) / 2, (Math.max(...lons) + Math.min(...lons)) / 2);
    map.setLevel(target, { anchor: center, animate: { duration: 400 } });
    K.event.addListener(map, "idle", function once() {
      K.event.removeListener(map, "idle", once);
      map.panTo(center);                                  // 확대한 구역을 화면 가운데로
      if (samePlace) {                                    // 최대로 확대해도 안 펼쳐짐 → 그 식당들을 시트 목록으로
        state.subset = new Set(ids);
        closeDetail();
        render();
        if (MOBILE.matches) setSheet("half");
      }
    });
  }

  // 핀 탭: 같은 건물(약 10m 안)에 다른 식당 핀이 겹쳐 있으면 그 식당들을 목록으로, 아니면 상세
  function onPinTap(r) {
    const near = [...pins.values()].map((p) => p.r)
      .filter((x) => Math.abs(x.lat - r.lat) < SAME_PLACE_DEG / 3 && Math.abs(x.lon - r.lon) < SAME_PLACE_DEG / 3);
    if (near.length < 2) { openDetail(r.id, { pan: true }); return; }
    state.subset = new Set(near.map((x) => x.id));
    closeDetail();
    render();
    if (MOBILE.matches) setSheet("half");
    focusOn(r);
  }

  function clearSubset() {
    if (!state.subset) return false;
    state.subset = null;
    return true;
  }

  function drawMarkers(rows, fit) {
    if (!map) return;
    const K = kakao.maps;
    clusterer.clear();
    pins.clear();
    const overlays = [];
    for (const r of rows) {
      if (r.lat == null) continue;
      const node = pinNode(r);
      // clickable: 핀을 탭해도 지도 'click'(빈 곳 탭 → 시트 접기)이 함께 일어나지 않게
      const overlay = new K.CustomOverlay({ position: new K.LatLng(r.lat, r.lon), content: node, yAnchor: 1, zIndex: 2,
                                            clickable: true });
      pins.set(r.id, { overlay, node, r });
      overlayId.set(overlay, r.id);
      overlays.push(overlay);
    }
    clusterer.addMarkers(overlays);
    highlightPin(state.selected);
    drawNear();
    drawMe();
    if (fit) fitTo(rows);
  }

  function padding() {
    // 지도 위를 가리는 영역(모바일 상단 검색창 · 아래 시트)만큼 여백
    if (!MOBILE.matches) return [60, 60, 60, 60];
    const top = el.topbar.getBoundingClientRect().bottom + 16;
    const bottom = window.innerHeight - el.panel.getBoundingClientRect().top + 24;
    return [top, 40, Math.max(bottom, 60), 40];
  }

  // 중심(lat, lon)에서 반경 km 가 다 보이는 범위 — 중심이 화면 가운데에 오도록 대칭으로 잡는다
  function circleBounds(lat, lon, km) {
    const K = kakao.maps;
    const dLat = km / 111, dLon = km / (111 * Math.cos(lat * Math.PI / 180));
    return new K.LatLngBounds(new K.LatLng(lat - dLat, lon - dLon), new K.LatLng(lat + dLat, lon + dLon));
  }

  function fitTo(rows) {
    const K = kakao.maps;
    const pts = rows.filter((r) => r.lat != null);
    if (state.near) {
      map.setBounds(circleBounds(state.near.lat, state.near.lon, state.radiusKm), ...padding());
      return;
    }
    if (state.me && !state.region) {
      // 내 위치를 가운데에 두고, 반경이 있으면 그 원이, '전체'면 가장 가까운 3곳까지 보이게 (최대 5km)
      const nearest = pts.slice(0, 3).map((r) => r._dist).filter((d) => d != null);
      const km = state.meRadiusKm || Math.min(Math.max(...nearest, 0.4), 5);
      map.setBounds(circleBounds(state.me.lat, state.me.lon, km), ...padding());
      return;
    }
    if (!pts.length) return;
    if (pts.length === 1) { map.setLevel(4); map.setCenter(new K.LatLng(pts[0].lat, pts[0].lon)); return; }
    const b = new K.LatLngBounds();
    for (const r of pts) b.extend(new K.LatLng(r.lat, r.lon));
    map.setBounds(b, ...padding());
  }

  function focusOn(r) {
    const K = kakao.maps;
    if (map.getLevel() > 5) map.setLevel(4, { animate: true });
    map.panTo(new K.LatLng(r.lat, r.lon));
    if (MOBILE.matches) {
      // 핀이 아래 시트에 가려지지 않게 위로 조금 올린다
      setTimeout(() => {
        const sheetTop = el.panel.getBoundingClientRect().top;
        const topbar = el.topbar.getBoundingClientRect().bottom;
        map.panBy(0, Math.round((window.innerHeight - sheetTop) / 2 - topbar / 2));
      }, 300);
    }
  }

  function highlightPin(id) {
    if (!map) return;
    if (labelOverlay) { labelOverlay.setMap(null); labelOverlay = null; }
    for (const [pid, p] of pins) p.node.classList.toggle("is-active", pid === id);
    const p = pins.get(id);
    if (p) {
      const label = document.createElement("div");
      label.className = "pin-label";
      label.textContent = p.r.name;
      // yAnchor 1 = 이름표 아래끝이 좌표. CSS margin-bottom 으로 핀 머리 위에 띄운다
      labelOverlay = new kakao.maps.CustomOverlay({ position: p.overlay.getPosition(), content: label,
                                                   yAnchor: 1, zIndex: 6, clickable: false });
      labelOverlay.setMap(map);
    }
  }

  function drawNear() {
    if (nearOverlay) { nearOverlay.setMap(null); nearOverlay = null; }
    if (nearCircle) { nearCircle.setMap(null); nearCircle = null; }
    if (!state.near || !map) return;
    const K = kakao.maps;
    const c = new K.LatLng(state.near.lat, state.near.lon);
    nearCircle = new K.Circle({ center: c, radius: state.radiusKm * 1000, strokeWeight: 2, strokeColor: "#2f6bff",
                                strokeOpacity: 0.55, strokeStyle: "shortdash", fillColor: "#2f6bff", fillOpacity: 0.06 });
    nearCircle.setMap(map);
    const dot = document.createElement("div");
    dot.className = "here";
    nearOverlay = new K.CustomOverlay({ position: c, content: dot, zIndex: 1 });
    nearOverlay.setMap(map);
  }

  function drawMe() {
    if (meOverlay) { meOverlay.setMap(null); meOverlay = null; }
    if (meCircle) { meCircle.setMap(null); meCircle = null; }
    if (!state.me || !map) return;
    const K = kakao.maps;
    const c = new K.LatLng(state.me.lat, state.me.lon);
    if (state.meRadiusKm && !state.near) {
      meCircle = new K.Circle({ center: c, radius: state.meRadiusKm * 1000, strokeWeight: 2, strokeColor: "#1a73e8",
                                strokeOpacity: 0.5, strokeStyle: "shortdash", fillColor: "#1a73e8", fillOpacity: 0.05 });
      meCircle.setMap(map);
    }
    const dot = document.createElement("div");
    dot.className = "me-dot";
    dot.setAttribute("aria-label", "내 위치");
    meOverlay = new K.CustomOverlay({ position: c, content: dot, zIndex: 4, clickable: false });
    meOverlay.setMap(map);
  }

  // ---------------------------------------------------------------- 내 위치
  // 위치는 브라우저에서만 쓴다: 거리 계산·정렬·파란 점 표시. 저장하거나 서버·카카오로 보내지 않는다
  // (지도를 그 근처로 옮기면 지도 타일은 그 지역 것을 받아 오지만, 좌표 자체를 넘기지는 않는다).
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) return reject({ code: 0 });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), 4000);
  }

  async function locate({ user = false } = {}) {
    el.locate.setAttribute("aria-busy", "true");
    try {
      state.me = await getPosition();
      if (user && state.near) {           // 장소 주변 찾기 중이었으면 끄고 내 위치 기준으로
        state.near = null;
        el.q.value = "";
        state.q = "";
      }
      if (user) closeDetail();
      render({ fit: !!map && !state.near });
    } catch (e) {
      // 거부·실패해도 화면은 지금처럼(최신 영상 순). 처음에는 한 번만 작게 알리고, 버튼을 눌렀을 때는 이유를 알린다
      if (user) {
        toast(e && e.code === 1 ? "브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요"
                                : "현재 위치를 찾지 못했어요. 잠시 후 다시 눌러 주세요");
      } else if (!state.geoNoticeShown) {
        state.geoNoticeShown = true;
        toast("위치를 확인할 수 없어 최신 영상 순으로 보여드려요");
      }
    } finally {
      el.locate.removeAttribute("aria-busy");
    }
  }

  // ---------------------------------------------------------------- 장소 주변 찾기
  function searchPlace(text) {
    const S = kakao.maps.services;
    return new Promise((resolve) => {
      new S.Geocoder().addressSearch(text, (res, status) => {
        if (status === S.Status.OK && res[0]) {
          return resolve({ lat: +res[0].y, lon: +res[0].x, label: res[0].address_name || text });
        }
        new S.Places().keywordSearch(text, (data, st) => {
          if (st === S.Status.OK && data[0]) resolve({ lat: +data[0].y, lon: +data[0].x, label: data[0].place_name });
          else resolve(null);
        }, { size: 1 });
      });
    });
  }

  async function startNear(text) {
    text = text.trim();
    if (!text || !mapReady()) return;
    el.nearSuggest.disabled = true;
    const found = await searchPlace(text);
    el.nearSuggest.disabled = false;
    if (!found) {
      el.nearSuggest.hidden = false;
      el.nearSuggest.textContent = `‘${text}’ 위치를 찾지 못했어요. 다른 이름으로 검색해 보세요`;
      return;
    }
    state.near = { ...found, query: text };
    state.q = "";
    closeDetail();
    el.q.blur();
    if (MOBILE.matches) setSheet("half");
    render({ fit: true });
  }

  function clearNear() {
    state.near = null;
    state.q = el.q.value;
    render({ fit: true });
  }

  // ---------------------------------------------------------------- 보기 전환 · 모바일 시트
  function setView(view) {
    state.view = view;
    el.app.dataset.view = view;
    for (const b of el.viewSeg.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.view === view));
    if (MOBILE.matches) setSheet(view === "list" ? "full" : "closed");
    else if (map) setTimeout(() => { map.relayout(); render({ fit: true }); }, 0);
  }

  // env(safe-area-inset-bottom) 값(px). 일반 브라우저에서는 0, 홈 화면 앱(아이폰)에서는 홈 표시줄 높이
  function safeBottom() {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:env(safe-area-inset-bottom);visibility:hidden";
    document.body.appendChild(d);
    const h = d.offsetHeight;
    d.remove();
    return h;
  }

  function sheetGeometry() {
    const vh = window.innerHeight;
    const top = Math.round(el.topbar.getBoundingClientRect().bottom + 4);
    const h = vh - top;
    // 접힌 높이 = 손잡이 + 'N곳' 한 줄. 반경 버튼 표시 여부·상세 열림과 상관없이 늘 같은 높이
    const closedH = el.grip.offsetHeight + 42 + safeBottom();          // 홈 화면 앱: 홈 표시줄만큼 더
    return { top, offsets: { full: 0, half: Math.round(h - vh * 0.46), closed: Math.round(h - closedH) } };
  }

  function setSheet(name, { animate = true } = {}) {
    if (!MOBILE.matches) return;
    if (name === "closed" && state.selected != null) closeDetail();   // 상세에서 내리면 목록 바로 접힘
    if (name === "closed" && clearSubset()) render();                  // 같은 위치 목록도 접으면 원래 목록으로
    state.sheet = name;
    el.panel.dataset.sheet = name;
    el.app.dataset.sheet = name;                                        // 앱 설치 안내 띠는 접혔을 때만 (style.css)
    el.panel.classList.toggle("is-closed", name === "closed");
    const g = sheetGeometry();
    el.panel.classList.toggle("dragging", !animate);
    el.app.style.setProperty("--sheet-top", `${g.top}px`);
    el.app.style.setProperty("--sheet-y", `${g.offsets[name]}px`);
    el.app.style.setProperty("--sheet-visible", `${window.innerHeight - g.top - g.offsets[name]}px`);
    const wantView = name === "full" ? "list" : "map";
    if (state.view !== wantView) {
      state.view = wantView;
      el.app.dataset.view = wantView;
      for (const b of el.viewSeg.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.view === wantView));
    }
  }

  function enableSheetDrag() {
    let startY = 0, startOffset = 0, dragging = false, moved = false;
    const onDown = (e) => {
      if (!MOBILE.matches || e.target.closest("button")) return;     // 반경 버튼 등은 끌기가 아니라 누르기
      dragging = true; moved = false;
      startY = e.clientY;
      startOffset = sheetGeometry().offsets[state.sheet];
      el.panel.classList.add("dragging");
      el.app.classList.add("sheet-dragging");                         // 끄는 동안 앱 설치 띠 숨김
      e.target.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      const y = Math.max(0, startOffset + dy);
      el.app.style.setProperty("--sheet-y", `${y}px`);
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      el.panel.classList.remove("dragging");
      el.app.classList.remove("sheet-dragging");
      const g = sheetGeometry();
      const y = startOffset + (e.clientY - startY);
      if (!moved) {                       // 탭: 접힘 → 반 → 전체 → 반
        setSheet(state.sheet === "closed" ? "half" : state.sheet === "half" ? "full" : "half");
        return;
      }
      // 끈 방향의 가장 가까운 단계로 (조금만 내려도 다음 단계로 내려가게)
      const dy = e.clientY - startY;
      const order = ["full", "half", "closed"];
      const i = order.indexOf(state.sheet);
      const candidates = Math.abs(dy) < 40 ? [state.sheet]
        : dy > 0 ? order.slice(Math.min(i + 1, 2)) : order.slice(0, Math.max(i, 1));
      const nearest = candidates.sort((a, b) => Math.abs(g.offsets[a] - y) - Math.abs(g.offsets[b] - y))[0];
      setSheet(nearest);
    };
    for (const h of [el.grip, el.listMeta]) {
      h.addEventListener("pointerdown", onDown);
      h.addEventListener("pointermove", onMove);
      h.addEventListener("pointerup", onUp);
      h.addEventListener("pointercancel", onUp);
    }
  }

  // ---------------------------------------------------------------- 이벤트
  function bind() {
    el.q.addEventListener("input", () => {
      if (state.near && el.q.value.trim() !== state.near.query) state.near = null;
      clearSubset();
      state.q = el.q.value;
      render();
    });
    el.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = el.q.value.trim();
      if (!text) return;
      // 상호·주소로 걸리는 식당이 없으면 장소로 보고 주변을 찾는다
      if (visible().length === 0 && mapReady()) startNear(text);           // 장소 주변 찾기 (시트를 연다)
      else {
        el.q.blur();
        render({ fit: true });
        if (MOBILE.matches) setSheet("half");                               // 검색 실행 → 결과 목록
      }
    });
    el.qClear.addEventListener("click", () => { el.q.value = ""; state.q = ""; state.near = null; render({ fit: true }); el.q.focus(); });
    el.nearSuggest.addEventListener("click", () => startNear(el.q.value));
    el.nearClear.addEventListener("click", () => { el.q.value = ""; clearNear(); });
    el.radius.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-km]");
      if (!b) return;
      state.radiusKm = +b.dataset.km;
      render({ fit: true });
    });
    el.locate.addEventListener("click", () => locate({ user: true }));
    el.meRadius.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-km]");
      if (!b) return;
      state.meRadiusKm = +b.dataset.km;
      render({ fit: true });
    });
    el.region.addEventListener("change", () => { state.region = el.region.value; clearSubset(); closeDetail(); render({ fit: true }); });
    el.channelBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleChannelPop(); });
    el.channelPop.addEventListener("click", (e) => {
      e.stopPropagation();
      const b = e.target.closest(".ch-item");
      if (!b) return;
      const c = b.dataset.ch;
      if (!c) state.channels.clear();
      else state.channels.has(c) ? state.channels.delete(c) : state.channels.add(c);
      clearSubset();
      renderChannels();
      render({ fit: true });
    });
    document.addEventListener("click", (e) => { if (!e.target.closest("#channelPick")) toggleChannelPop(false); });
    el.subsetClear.addEventListener("click", () => { clearSubset(); render(); });
    el.chips.addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      const c = b.dataset.cat;
      if (!c) state.cats.clear();
      else state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c);
      clearSubset();
      render({ fit: true });
    });
    el.viewSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-view]");
      if (b) setView(b.dataset.view);
    });
    const pick = (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      if (!MOBILE.matches && state.view === "list") setView("map");
      openDetail(+card.dataset.id);
    };
    el.list.addEventListener("click", pick);
    el.list.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(e); });
    el.detail.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-action]");
      if (!a) return;
      if (a.dataset.action === "back") closeDetail();
      if (a.dataset.action === "mode") {
        state.routeMode = a.dataset.mode;
        for (const b of el.detail.querySelectorAll("[data-action=mode]")) b.setAttribute("aria-checked", String(b === a));
      }
      if (a.dataset.action === "route") {
        const r = state.all.find((x) => x.id === state.selected);
        if (r) openRoute(a.dataset.app, r);
      }
      if (a.dataset.action === "copy") {
        const r = state.all.find((x) => x.id === state.selected);
        try { await navigator.clipboard.writeText(r.address); a.textContent = "복사됨"; } catch { a.textContent = "복사 실패"; }
        setTimeout(() => (a.textContent = "복사"), 1500);
      }
    });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.selected != null) closeDetail(); });
    window.addEventListener("resize", () => { if (MOBILE.matches) setSheet(state.sheet, { animate: false }); map?.relayout(); });
    MOBILE.addEventListener("change", () => {
      el.app.style.removeProperty("--sheet-y");
      if (MOBILE.matches) setSheet("closed", { animate: false });
      setTimeout(() => { map?.relayout(); render({ fit: true }); }, 50);
    });
    enableSheetDrag();
  }

  function showMapMessage(html) {
    el.mapMessage.innerHTML = `<div>${html}</div>`;
    el.mapMessage.hidden = false;
  }

  // ---------------------------------------------------------------- 앱 설치 안내 (휴대폰)
  // 안드로이드 크롬: beforeinstallprompt 를 잡아 두었다가 [설치] → 바로 설치 창
  // 아이폰 사파리: 설치 API 가 없어 '공유 → 홈 화면에 추가' 안내 / 아이폰의 다른 브라우저: 사파리에서 열라는 안내
  // 앱으로 실행 중·설치함·[닫기](30일) 이면 띄우지 않는다. localStorage 에는 이 두 표시만 둔다 (위치는 저장 안 함)
  const INSTALL_DISMISSED = "matjip-install-dismissed", INSTALLED = "matjip-installed";
  const DISMISS_DAYS = 30;
  const IC_SHARE = `<svg class="ios-ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v11M8 7l4-4 4 4M8 10H6v10h12V10h-2"/></svg>`;
  const IC_ADD = `<svg class="ios-ic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM12 8v8M8 12h8"/></svg>`;
  const INSTALL_TEXT = {
    prompt: "<b>맛도리를 홈 화면에 설치하기</b>주소창 없이 앱처럼 바로 열려요",
    ios: `<b>맛도리를 홈 화면에 추가하기</b>${IC_SHARE} 공유 → ${IC_ADD} 홈 화면에 추가 <small>(공유가 안 보이면 ··· 먼저)</small>`,
    iosOther: "<b>사파리에서 열어 주세요</b>Safari 에서 맛도리를 홈 화면에 추가할 수 있어요",
  };
  let installPrompt = null;

  const storeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 하면 이번만 */ } };

  function isStandalone() {
    return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches
      || navigator.standalone === true;                                   // 아이폰 홈 화면 앱
  }

  function installSuppressed() {
    if (isStandalone() || storeGet(INSTALLED)) return true;
    const t = +storeGet(INSTALL_DISMISSED);
    return t > 0 && Date.now() - t < DISMISS_DAYS * 864e5;
  }

  // 아이폰 브라우저: 사파리만 '홈 화면에 추가' 안내, 크롬·카카오톡 등 앱 안 브라우저는 사파리로 안내
  function iosBrowser() {
    const ua = navigator.userAgent || "";
    if (/CriOS|FxiOS|EdgiOS|KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//.test(ua)) return "other";
    return /Version\/[\d.]+.*Safari\//.test(ua) ? "safari" : "other";
  }

  function showInstall(kind) {
    if (installSuppressed()) return;
    el.installText.innerHTML = INSTALL_TEXT[kind];
    el.installGo.hidden = kind !== "prompt";
    el.installBar.hidden = false;
    el.app.classList.add("has-install");
  }

  function hideInstall() {
    el.installBar.hidden = true;
    el.app.classList.remove("has-install");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();                   // 크롬 기본 안내 대신 우리 띠 ([닫기] 했으면 아무것도 안 띄움)
    installPrompt = e;
    showInstall("prompt");
  });
  window.addEventListener("appinstalled", () => { storeSet(INSTALLED, "1"); installPrompt = null; hideInstall(); });

  function bindInstall() {
    // 띠 높이 → '마지막 업데이트'를 그 위로 (시트가 열려 있으면 띠가 숨겨져 0 이라, 보일 때마다 다시 잰다)
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        if (el.installBar.offsetHeight) el.app.style.setProperty("--install-h", `${el.installBar.offsetHeight}px`);
      }).observe(el.installBar);
    }
    el.installClose.addEventListener("click", () => { storeSet(INSTALL_DISMISSED, String(Date.now())); hideInstall(); });
    el.installGo.addEventListener("click", async () => {
      const p = installPrompt;
      if (!p) return hideInstall();
      installPrompt = null;               // prompt() 는 이벤트마다 한 번만 쓸 수 있다
      hideInstall();
      p.prompt();
      const { outcome } = await p.userChoice;
      if (outcome === "accepted") storeSet(INSTALLED, "1");  // 설치 창에서 취소하면 이번에만 숨김 (다음 방문 때 다시)
    });
    if (deviceKind() === "ios") setTimeout(() => showInstall(iosBrowser() === "safari" ? "ios" : "iosOther"), 1200);
  }

  // ---------------------------------------------------------------- 방문자 수 (GoatCounter 공개 카운터)
  // GoatCounter 사이트 설정의 'Allow adding visitor counts on your website' 를 켜야 숫자가 온다 (꺼져 있으면 403 → 숨김).
  // 로컬에서는 index.html 이 count.js 를 안 불러와 window.goatcounter 가 없으니 카운터도 안 보인다
  const VISITS_URL = "https://matdori.goatcounter.com/counter/TOTAL.json";
  async function loadVisits() {
    if (!window.goatcounter) return;
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);       // 한국 날짜
    const get = (q) => fetch(VISITS_URL + q).then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && d.count != null ? String(d.count) : null)).catch(() => null);
    const [day, total] = await Promise.all([get(`?start=${today}`), get("")]);
    if (total == null) return;
    el.updated.insertAdjacentHTML("beforeend", `<span class="visits">${
      day != null ? ` · 오늘 방문 <b>${esc(day)}</b>` : ""} · 누적 <b>${esc(total)}</b></span>`);
    el.updated.hidden = false;
  }

  // ---------------------------------------------------------------- 시작
  async function main() {
    bind();
    bindInstall();
    setView("map");
    // 모바일 첫 화면은 지도가 주인공: 시트는 접힌 바(손잡이 + 'N곳')로 시작
    if (MOBILE.matches) setSheet("closed", { animate: false });
    let data;
    try {
      const res = await fetch("data/restaurants.json", { cache: "no-cache" });
      data = await res.json();
    } catch {
      el.list.innerHTML = "";
      el.empty.hidden = false;
      el.empty.querySelector(".empty-title").textContent = "식당 데이터를 불러오지 못했어요";
      el.empty.querySelector(".empty-sub").textContent = "python -m matjip export 를 먼저 실행하세요";
      return;
    }
    state.all = data.restaurants || [];
    if (data.updated_at) {
      const [d, t] = data.updated_at.split(" ");
      const [, m, day] = d.split("-");
      el.updated.innerHTML = `마지막 업데이트 <b>${+m}/${+day} ${esc(t || "")}</b>`;
    } else el.updated.hidden = true;
    renderRegionOptions();
    renderChips();
    render();
    loadVisits();

    // 처음 열 때 위치 권한 요청 (지도 로딩과 동시에). 허용하면 가까운 순 + 지도를 내 위치로
    renderChannels();
    // 홈 화면 앱: 서비스 워커 등록 (네트워크 우선, 오프라인일 때만 캐시 — sw.js)
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    locate();

    try {
      await loadKakao((window.MATJIP_CONFIG || {}).kakaoJsKey);
      initMap();
      render({ fit: true });
    } catch (e) {
      showMapMessage(e.message === "nokey"
        ? "<b>지도를 표시하려면 카카오 JavaScript 키가 필요해요</b><br>.env 에 KAKAO_JS_KEY 를 넣고 python -m matjip export 를 실행하세요"
        : "<b>카카오 지도를 불러오지 못했어요</b><br>키와 사이트 도메인 등록(카카오 개발자 콘솔)을 확인하세요");
      renderNear();
    }
  }

  window.matjipDebug = { state, routeLinks, level: () => map?.getLevel() };
  main();
})();
