/* 맛도리 (유튜버·방송이 인정한 맛집 지도) — 빌드 도구 없는 정적 웹앱.
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
  const CREDIT = "개발자 유니주니 · 후원 강남오빠(안호성)";   // 제작자 표시 (index.html 의 PC 패널 문구와 같게)
  const ABOUT_LINK = `<a class="about-link" href="about.html">이용 안내</a>`;   // 이용 안내(개인정보·출처·정정 요청) 페이지
  const COPYRIGHT = "© 2026 맛도리(유니주니). 화면·데이터의 무단 복제·배포를 금합니다.";   // 무단 복제 대비 (index.html PC 패널·about.html 과 같은 문구, LICENSE)
  // 터치 기기 (휴대폰·태블릿·터치 노트북): 핀치를 직접 처리 (enablePinchZoom)
  const COARSE = { matches: window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0 };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ytThumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;   // 16:9, 검은 띠 없음

  const state = {
    all: [],
    q: "",
    cats: new Set(),
    channels: new Set(), // 채널(프로그램) 여러 개 선택. 비면 전체
    famousOnly: false,   // '유명 유튜버만' (channels.csv famous=1 채널 영상이 있는 가게만). 기본 꺼짐
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
    subsetClear: $("subsetClear"), famousBtn: $("famousBtn"),
    ytNotice: $("ytNotice"), ytNoticeOk: $("ytNoticeOk"),
    installBar: $("installBar"), installText: $("installText"), installGo: $("installGo"), installClose: $("installClose"),
    inappBar: $("inappBar"), inappText: $("inappText"), inappOpen: $("inappOpen"), inappCopy: $("inappCopy"), inappClose: $("inappClose"),
  };

  // ---------------------------------------------------------------- 유틸
  function distanceKm(aLat, aLon, bLat, bLon) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10}m` : `${km.toFixed(1)}km`);
  // 방송 출연 셰프 가게 (흑백요리사 — export 의 r.broadcast, 사용자 승인 후에만 들어옴). 영상이 없을 수 있다.
  // 채널 필터에는 '방송 › 흑백요리사', 배지는 글자만 '흑백요리사 · ○○ 셰프' (원칙 11: 방송사 로고·방송 화면 이미지 금지)
  const BROADCAST = "방송 › ";
  const broadcastsOf = (r) => r.broadcast || [];
  const programsOf = (r) => [...new Set([...r.videos.map((v) => v.program).filter(Boolean),
                                         ...broadcastsOf(r).map((b) => BROADCAST + b.program)])];
  // 셰프 이름이 출처마다 다르면 export 가 chef='' 로 보냄 → 배지는 '흑백요리사'만
  const tvLabel = (b) => (b.chef ? `${b.program} · ${b.chef} 셰프` : b.program);
  const tvBadges = (r) => broadcastsOf(r).map((b) =>
    `<span class="badge badge-tv" title="${esc(b.program)} 시즌${esc(b.season)} 출연 셰프의 가게">${esc(tvLabel(b))}</span>`).join("");
  // 출처에 코스·오마카세·예약제로 적힌 가게만 상세에 작은 회색 태그 (가격은 쓰지 않음)
  const courseTag = (r) => (broadcastsOf(r).some((b) => b.course)
    ? `<span class="badge badge-course" title="출처에 코스·오마카세·예약제로 소개된 가게">코스·예약제</span>` : "");
  // 썸네일: 영상이 있으면 유튜브 썸네일, 방송 가게뿐이면 글자 자리표시 (방송 화면 이미지는 쓰지 않음)
  const thumbHTML = (r, cls = "thumb") => {
    const src = r.videos[0] ? ytThumb(r.videos[0].id) : r.thumb;
    if (src) return `<div class="${cls}"><img loading="lazy" src="${esc(src)}" alt="">${cls === "thumb" ? `<span class="play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>` : ""}</div>`;
    const b = broadcastsOf(r)[0];
    return `<div class="${cls} thumb-tv"><span>${esc(b ? b.program : r.name)}</span></div>`;
  };
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
  // 상세의 상호명 → 네이버 검색(예약·메뉴). 검색어는 '구 이름 + 상호명' ('안양시 만안구' 면 '만안구')
  const guName = (r) => (r.subregion || "").split(" ").filter((t) => /[구시군]$/.test(t)).pop() || r.region || "";
  const naverInfo = (r) => `https://m.search.naver.com/search.naver?query=${encodeURIComponent(`${guName(r)} ${r.name}`.trim())}`;
  // 조회수: '조회수 12만' (가게는 영상 중 최대값). refresh 가 매일 갱신
  const fmtViews = (n) => n >= 1e8 ? `${+(n / 1e8).toFixed(1)}억` : n >= 1e5 ? `${Math.round(n / 1e4)}만`
    : n >= 1e4 ? `${+(n / 1e4).toFixed(1)}만` : n.toLocaleString("ko-KR");
  const maxViews = (r) => Math.max(0, ...r.videos.map((v) => v.views || 0));
  const viewsTag = (n) => (n > 0 ? `<span class="views">조회수 ${fmtViews(n)}</span>` : "");
  const naverSearch = (r) => `https://map.naver.com/p/search/${encodeURIComponent(`${r.name} ${r.subregion || r.region}`)}`;

  // ---------------------------------------------------------------- 길찾기 (휴대폰: 앱 바로, 없으면 웹 / PC: 웹)
  // 카카오맵: kakaomap://route?ep=위도,경도&by=car|publictransit|foot (KakaoMapsSDK URL Scheme 문서)
  //           앱 없으면·PC 는 map.kakao.com/link/to/… (지도 웹 가이드)
  // 네이버:   nmap://route/{public|walk|car}?dlat&dlng&dname&appname (NCP Maps URL Scheme 문서, appname 필수)
  //           공식 웹 길찾기 URL 은 문서에 없어 앱이 없거나 PC 면 네이버지도 웹에서 그 식당을 연다
  // '내 위치' 좌표는 링크에 넣지 않는다 (2026-10-14 개인정보 점검: sp=·slat= 로 기기 밖에 나가던 경로).
  // 출발지를 비우면 카카오맵·네이버지도 앱이 각자 현재 위치를 출발지로 쓴다
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

  function routeLinks(app, r, mode = state.routeMode, device = deviceKind()) {
    const m = ROUTE[mode] || ROUTE.public;
    const name = encodeURIComponent(r.name);
    if (app === "kakao") {
      const qs = `ep=${r.lat},${r.lon}&by=${m.kakaoApp}`;
      const web = `https://map.kakao.com/link/to/${name},${r.lat},${r.lon}`;
      if (device === "pc") return { url: web };
      if (device === "android") {
        return { url: `intent://route?${qs}#Intent;scheme=kakaomap;package=net.daum.android.map;`
                      + `S.browser_fallback_url=${encodeURIComponent(web)};end` };
      }
      return { url: `kakaomap://route?${qs}`, fallback: web };
    }
    const appname = encodeURIComponent(location.origin + location.pathname);   // 네이버: 호출한 사이트를 appname 으로
    const qs = `dlat=${r.lat}&dlng=${r.lon}&dname=${name}&appname=${appname}`;
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
    if (state.channels.size && !programsOf(r).some((p) => state.channels.has(p))) return false;
    // '유명 유튜버만' 토글: 유명 채널 영상이 있거나 방송(흑백요리사) 가게
    if (state.famousOnly && !(r.videos.some((v) => v.famous) || broadcastsOf(r).length)) return false;
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
    // 버튼 이름은 짧게: '방송 › 흑백요리사' → '흑백요리사' (휴대폰에서 길면 지도/목록 버튼이 다음 줄로 밀림)
    el.channelLabel.textContent = sel.length === 0 ? "채널" : sel.length === 1 ? sel[0].replace(BROADCAST, "") : `채널 ${sel.length}`;
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
    return `<li class="card${state.selected === r.id ? " is-active" : ""}" data-id="${r.id}" tabindex="0">
      ${thumbHTML(r)}
      <div class="info">
        <h3>${esc(r.name)}</h3>
        <div class="meta"><span class="cat" style="--c:${COLORS[r.category] || COLORS["기타"]}">${esc(r.category)}</span>
          <span>${esc(r.hood || r.region)}</span>${dist}</div>
        <div class="badges">${tvBadges(r)}${progs.filter((p) => p !== REGION_PROGRAM && !p.startsWith(BROADCAST)).map((p) => `<span class="badge badge-prog">${esc(p)}</span>`).join("")}${
          regionChannels(r).map((c) => `<span class="badge badge-prog">${esc(c)}</span>`).join("")}${
          progs.includes(REGION_PROGRAM) ? regionBadge : ""}${autoBadge(r)}${adBadges(r)}${viewsTag(maxViews(r))}${
          r.videos.length > 1 ? `<span class="badge-count">영상 ${r.videos.length}개</span>` : ""}</div>
      </div></li>`;
  }

  function render({ fit = false, start = false } = {}) {
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
    el.empty.querySelector(".empty-title").textContent = state.famousOnly
      ? "이 지역은 유명 유튜버 맛집이 아직 없어요" : "조건에 맞는 식당이 없어요";
    el.empty.querySelector(".empty-sub").textContent = state.famousOnly
      ? "★ 유명 유튜버만을 끄면 모든 맛집을 볼 수 있어요" : "필터를 줄이거나 반경을 넓혀 보세요";
    el.famousBtn.setAttribute("aria-pressed", String(state.famousOnly));
    for (const b of el.chips.querySelectorAll(".chip")) {
      const c = b.dataset.cat;
      b.setAttribute("aria-pressed", String(c ? state.cats.has(c) : state.cats.size === 0));
    }
    renderNear();
    drawMarkers(rows, fit, start);
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
      ${thumbHTML(r, "hero")}
      <h2><a class="name-link" href="${naverInfo(r)}" target="_blank" rel="noopener">${esc(r.name)}<span class="chev" aria-hidden="true">›</span></a></h2>
      <p class="name-sub">네이버에서 예약·메뉴 보기</p>
      <div class="meta"><span class="cat" style="--c:${COLORS[r.category] || COLORS["기타"]}">${esc(r.category)}</span>
        <span>${esc(r.hood || r.region)}</span>${dist}${tvBadges(r)}${courseTag(r)}${autoBadge(r)}${programsOf(r).includes(REGION_PROGRAM) ? regionBadge : ""}${adBadges(r)}${viewsTag(maxViews(r))}</div>
      <p class="addr"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>
        <span>${esc(r.address)}</span><button type="button" class="copy" data-action="copy">복사</button></p>
      ${broadcastsOf(r).length ? `<h4 class="section-title">나온 방송</h4>
      <ul class="tv-list">${broadcastsOf(r).map((x) => `<li><b>${esc(x.program)}</b> 시즌${esc(x.season)} · ${x.chef ? `${esc(x.chef)} 셰프의 가게` : "출연 셰프의 가게"}</li>`).join("")}</ul>` : ""}
      ${r.videos.length ? `<h4 class="section-title">나온 영상 <span class="yt">${r.videos.length}</span></h4>
      <ul class="videos">${r.videos.map((v) => `
        <li><a class="video" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener">
          <div class="thumb"><img loading="lazy" src="${ytThumb(v.id)}" alt=""></div>
          <div><b>${esc(v.title)}</b><span>${esc(videoSource(v))} · ${esc(v.date)}${v.views ? ` · 조회수 ${fmtViews(v.views)}` : ""}${v.ad ? ` ${adBadge(v.ad)}` : ""}</span>${
            v.ad && v.ad_note ? `<span class="ad-note">설명란 표기: “${esc(v.ad_note)}”</span>` : ""}</div></a></li>`).join("")}
      </ul>
      <p class="yt-source">영상·썸네일·조회수 출처: <a href="https://www.youtube.com" target="_blank" rel="noopener">YouTube</a> · 영상을 누르면 YouTube 에서 열립니다</p>` : ""}
      <div class="route-bar">${r.lat != null ? `
      <div class="route-mode" role="radiogroup" aria-label="이동수단">${Object.entries(ROUTE).map(([k, m]) =>
        `<button type="button" data-action="mode" data-mode="${k}" aria-checked="${state.routeMode === k}">${m.label}</button>`).join("")}
      </div>
      <div class="actions">
        <button type="button" class="btn btn-kakao" data-action="route" data-app="kakao">카카오맵 길찾기</button>
        <button type="button" class="btn btn-naver" data-action="route" data-app="naver">네이버지도 길찾기</button>
      </div>` : `
      <div class="actions"><a class="btn btn-naver" href="${naverSearch(r)}" target="_blank" rel="noopener">네이버지도에서 보기</a></div>`}</div>`;
    el.detail.hidden = false;
    el.scroll.hidden = true;
    el.listMeta.hidden = true;            // 모바일에서는 위 손잡이(sheet-grip)로 시트를 끌 수 있다
    el.detail.scrollTop = 0;
    for (const c of el.list.querySelectorAll(".card")) c.classList.toggle("is-active", +c.dataset.id === id);
    highlightPin(id);
    if (MOBILE.matches) setSheet("full");            // 핀·목록에서 가게를 누르면 바로 다 펼친다 (검색창·칩 바로 아래까지)
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
    map.setMaxLevel(MAX_LEVEL);                         // 핀치·휠·버튼·지역 맞춤 모두 이 레벨까지 (남한 전체가 들어오는 레벨)
    keepInKorea();
    // 사용자가 지도를 직접 움직였으면, 늦게 끝난 첫 위치 확인이 화면을 옮기지 않게
    K.event.addListener(map, "dragstart", () => { state.touched = true; });
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
    if (COARSE.matches) enablePinchZoom();              // 터치 기기: 핀치를 세기에 맞춰 (PC 마우스 휠은 카카오 기본 그대로)
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

  // ---------------------------------------------------------------- 핀치 확대·축소 (터치 기기)
  // 카카오 기본 핀치는 손가락 간격 비율로만 레벨을 바꾸고(반 → 1단계) 빠르기는 안 봐서, 동네에서 서울까지 4~5번 오므려야 했다.
  // 기본 줌을 끄고 직접 처리한다 (레벨 MIN_LEVEL~MAX_LEVEL):
  //  - 축소(오므리기): log2(간격 비율) 반올림(살짝이라도 1단계) + 빠르기 보너스(+1~2), 한 번에 최대 4단계
  //  - 확대(벌리기): 카카오 기본처럼 간격 비율로만 (2배 → 1단계, 4배 → 2단계), 한 번에 최대 2단계 (2026-10-14: 빠르기 보너스로
  //    16배까지 커져 손가락이 가리킨 곳을 지나쳐 버리던 문제)
  //  - 기준점: 손가락을 처음 댔을 때 두 손가락 가운데 있던 곳이, 손가락을 따라 움직여 **놓는 순간의 가운데**에 남는다.
  //    끄는 동안은 CSS translate+scale 로 손가락을 따라가고, 놓으면 목표 배율까지 0.2초 애니메이션 뒤 setLevel(anchor) +
  //    setCenter 로 같은 자리에 맞춘다 (레벨 1 = 2배라 배율이 딱 맞아 끊김 없음)
  // 한 손가락 이동·묶음 핀 탭은 카카오 그대로. 기본 줌을 끄면 두 번 탭 확대도 꺼지므로 그것도 직접(1단계 확대)
  // 최대 축소 13: 휴대폰(390x844)·PC(1280x800) 모두 남한 전체(제주 포함)가 들어오는 가장 가까운 레벨 (2026-10-14 측정 —
  // 12 는 휴대폰 위도 33.9~37.8·PC 34.0~37.7 만 보여 제주·강원 북부가 잘림)
  const MIN_LEVEL = 1, MAX_LEVEL = 13, PINCH_MAX_STEPS = 4, PINCH_MAX_IN = 2;

  const PINCH_MIN = 0.12;             // 이보다 작은 변화(간격 약 8% 이하)는 손떨림으로 보고 무시
  const PINCH_FAST = [2.5, 5];        // 축소 빠르기(초당 log2 비율): 2.5 이상 +1, 5 이상 +2 (반으로 0.4초 / 0.2초)

  // 남한 범위 (2026-10-15 느슨하게): 화면 가장자리가 아니라 '지도 중심'만 본다. 중심이 위도 33.0~38.3·경도 124.8~131.0
  // 안이면 아무것도 안 한다. 독도(동경 131.87)를 볼 때만(울릉도·독도 위도 37.0~37.8) 경도 131.9 까지.
  // 밖이면 중심만 가장 가까운 경계로 부드럽게 옮기고 레벨은 절대 바꾸지 않는다 (panTo).
  // 핀치·드래그·하단 시트를 끄는 중에는 안 한다 (손을 뗀 뒤 idle 에서만).
  // (2026-10-14 판은 화면 가장자리를 검사해, 위로 끌면 손을 뗀 뒤 다른 곳으로 이동해 버렸다)
  const KOREA = { s: 33.0, n: 38.3, w: 124.8, e: 131.0 };
  const DOKDO = { s: 37.0, n: 37.8, e: 131.9 };
  const CLAMP_TOL = 0.005;            // 이 정도(약 500m) 넘친 것은 그대로

  // 지도 중심 → 옮길 중심 [lat, lng], 범위 안이면 null
  function clampCenter(lat, lng, box = KOREA) {
    const east = lat >= DOKDO.s && lat <= DOKDO.n ? DOKDO.e : box.e;
    const toLat = Math.min(box.n, Math.max(box.s, lat)), toLng = Math.min(east, Math.max(box.w, lng));
    if (Math.abs(toLat - lat) <= CLAMP_TOL && Math.abs(toLng - lng) <= CLAMP_TOL) return null;
    return [toLat, toLng];
  }

  function keepInKorea() {
    const K = kakao.maps;
    K.event.addListener(map, "idle", () => {             // idle = 끌기·확대·애니메이션이 끝난 뒤 (끄는 중에는 안 옴)
      if (state.pinching || el.app.classList.contains("sheet-dragging")) return;
      const c = map.getCenter();
      const to = clampCenter(c.getLat(), c.getLng());
      if (to) map.panTo(new K.LatLng(to[0], to[1]));     // 중심만 이동, 레벨 그대로
    });
  }

  function pinchSteps(ratio, seconds) {
    const raw = Math.log2(ratio);                     // 오므리면 + (축소), 벌리면 - (확대)
    if (Math.abs(raw) < PINCH_MIN) return 0;
    const base = Math.max(1, Math.round(Math.abs(raw)));
    if (raw < 0) return -Math.min(PINCH_MAX_IN, base);   // 확대: 간격 비율로만
    const speed = raw / Math.max(seconds, 0.05);
    const bonus = speed >= PINCH_FAST[1] ? 2 : speed >= PINCH_FAST[0] ? 1 : 0;
    return Math.min(PINCH_MAX_STEPS, base + bonus);
  }

  // from(처음 손가락 가운데, 지도 기준 px) 에 있던 곳을 to(놓을 때 가운데) 에 두고 steps 단계 바꾼다
  function zoomAt(steps, from, to = from, { animate = true } = {}) {
    const K = kakao.maps;
    const mapEl = document.getElementById("map");
    const target = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, map.getLevel() + steps));
    const real = target - map.getLevel();
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const anchor = map.getProjection().coordsFromContainerPoint(new K.Point(from[0], from[1]));
    const done = () => {
      mapEl.style.transition = mapEl.style.transform = mapEl.style.transformOrigin = "";
      if (real) map.setLevel(target, { anchor });      // anchor 는 화면 from 자리에 그대로 (배율이 이미 맞아 안 튄다)
      if (dx || dy) {                                  // 손가락이 옮겨 간 만큼 지도도 옮긴다 (anchor → to)
        const c = [mapEl.clientWidth / 2 - dx, mapEl.clientHeight / 2 - dy];
        map.setCenter(map.getProjection().coordsFromContainerPoint(new K.Point(c[0], c[1])));
      }
    };
    if (!animate || (!real && !dx && !dy)) { done(); return Promise.resolve(real); }
    return new Promise((resolve) => {
      mapEl.style.transformOrigin = `${from[0]}px ${from[1]}px`;
      mapEl.style.transition = "transform .2s ease-out";
      requestAnimationFrame(() => { mapEl.style.transform = `translate(${dx}px, ${dy}px) scale(${2 ** -real})`; });
      setTimeout(() => { done(); resolve(real); }, 210);
    });
  }

  function enablePinchZoom() {
    const mapEl = document.getElementById("map");
    map.setZoomable(false);
    let p = null, lastTap = null;
    // 지도 기준 좌표. 끄는 동안 #map 에 CSS 변형이 걸려 getBoundingClientRect 가 바뀌므로, 변형이 없는 부모(.map-wrap) 기준으로
    const box = () => mapEl.parentElement.getBoundingClientRect();
    const mid = (t, r = box()) => [(t[0].clientX + t[1].clientX) / 2 - r.left, (t[0].clientY + t[1].clientY) / 2 - r.top];
    const gap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    mapEl.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        map.setDraggable(false);                      // 두 손가락 동안 카카오 이동은 멈추고 직접 따라감
        state.pinching = true;                        // 남한 범위 되돌리기는 핀치가 끝난 뒤에만
        state.touched = true;
        const c = mid(e.touches);
        p = { d0: gap(e.touches), d: gap(e.touches), c0: c, c, t0: e.timeStamp };
        mapEl.style.transition = "";
        mapEl.style.transformOrigin = `${c[0]}px ${c[1]}px`;
      }
    }, { passive: false, capture: true });
    mapEl.addEventListener("touchmove", (e) => {
      if (!p || e.touches.length < 2) return;
      e.preventDefault();                             // 브라우저 화면 확대 막기
      p.d = gap(e.touches);
      p.c = mid(e.touches);
      const scale = Math.min(16, Math.max(1 / 16, p.d / p.d0));
      // 처음 가운데에 있던 곳이 지금 손가락 가운데를 따라가게
      mapEl.style.transform = `translate(${p.c[0] - p.c0[0]}px, ${p.c[1] - p.c0[1]}px) scale(${scale})`;
    }, { passive: false, capture: true });
    const end = (e) => {
      if (p && e.touches.length < 2) {
        const pinch = p;
        p = null;
        const seconds = (e.timeStamp - pinch.t0) / 1000;
        const steps = pinchSteps(pinch.d0 / pinch.d, seconds);
        state.lastPinch = { ratio: +(pinch.d0 / pinch.d).toFixed(2), seconds: +seconds.toFixed(2), steps };   // 확인용
        // 지금 손가락 배율·위치에서 목표 배율로 이어서 (단계가 0 이어도 손가락이 옮겨 간 만큼은 지도 이동)
        zoomAt(steps, pinch.c0, pinch.c).then(() => { map.setDraggable(true); state.pinching = false; });
        lastTap = null;
        return;
      }
      // 두 번 탭 → 1단계 확대 (빈 지도에서만. 핀·묶음 원·버튼 제외)
      if (e.touches.length === 0 && e.changedTouches.length === 1 && !e.target.closest(".pin, .pin-label, button")) {
        const t = e.changedTouches[0], now = e.timeStamp;
        if (lastTap && now - lastTap.t < 300 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 30) {
          const r = box();
          zoomAt(-1, [t.clientX - r.left, t.clientY - r.top]);
          lastTap = null;
        } else lastTap = { t: now, x: t.clientX, y: t.clientY };
      }
    };
    mapEl.addEventListener("touchend", end, { capture: true });
    mapEl.addEventListener("touchcancel", end, { capture: true });
    // 기본 줌을 끄면 마우스 휠도 꺼지므로 (터치 노트북) 휠 한 번에 1단계
    let wheelAt = 0;
    mapEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.timeStamp - wheelAt < 250 || !e.deltaY) return;
      wheelAt = e.timeStamp;
      const r = box();
      zoomAt(e.deltaY > 0 ? 1 : -1, [e.clientX - r.left, e.clientY - r.top]);
    }, { passive: false });
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
      const v = visibleBox(), frac = (v.bottom - v.top) / mapEl().clientHeight;      // 실제로 보이는 높이 비율 (휴대폰)
      const viewSpan = Math.min((ne.getLat() - sw.getLat()) * frac, (ne.getLng() - sw.getLng()) * cos);
      const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lons) - Math.min(...lons)) * cos, 0.002);
      const steps = Math.floor(Math.log2((viewSpan * 0.7) / span));
      target = Math.max(1, level - Math.max(1, steps));
    }
    const center = new K.LatLng((Math.max(...lats) + Math.min(...lats)) / 2, (Math.max(...lons) + Math.min(...lons)) / 2);
    map.setLevel(target, { anchor: center, animate: { duration: 400 } });
    K.event.addListener(map, "idle", function once() {
      K.event.removeListener(map, "idle", once);
      centerVisible(center, { animate: true });           // 확대한 구역을 보이는 영역 가운데로
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

  function drawMarkers(rows, fit, start = false) {
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
    if (fit) fitTo(rows, { start });
  }

  const mapEl = () => document.getElementById("map");

  function padding() {
    // 지도 위를 가리는 영역(모바일 상단 검색창·칩 · 아래 시트)만큼 여백 [위, 오른쪽, 아래, 왼쪽]
    if (!MOBILE.matches) return [60, 60, 60, 60];
    const v = visibleBox();
    return [v.top + 12, 24, mapEl().clientHeight - v.bottom + 12, 24];
  }

  // 휴대폰에서 실제로 보이는 지도 영역 (지도 기준 px): 위는 검색창·칩 아래, 아래는 하단 시트 위
  function visibleBox() {
    const m = mapEl(), h = m.clientHeight, w = m.clientWidth;
    if (!MOBILE.matches) return { top: 0, bottom: h, left: 0, right: w };
    const r = m.parentElement.getBoundingClientRect();      // 핀치 중 CSS 변형이 없는 부모 기준
    const top = Math.max(0, el.topbar.getBoundingClientRect().bottom - r.top);
    const bottom = Math.min(h, el.panel.getBoundingClientRect().top - r.top);
    return { top, bottom: Math.max(top + 80, bottom), left: 0, right: w };
  }

  // latlng 이 '보이는 영역'의 가운데에 오도록 지도 중심을 옮긴다 (레벨 그대로)
  function centerVisible(latlng, { animate = false } = {}) {
    const K = kakao.maps, proj = map.getProjection(), v = visibleBox();
    const p = proj.containerPointFromCoords(latlng);
    const dx = p.x - (v.left + v.right) / 2, dy = p.y - (v.top + v.bottom) / 2;
    const c = proj.containerPointFromCoords(map.getCenter());
    const to = proj.coordsFromContainerPoint(new K.Point(c.x + dx, c.y + dy));
    if (animate) map.panTo(to); else map.setCenter(to);
  }

  // 범위를 '보이는 영역' 기준으로 맞춘다. 최대 축소로도 위아래가 다 안 들어가면 남쪽(제주)을 보이는 영역 아래에 맞춤
  // — 북쪽(서울)은 끌어서 본다 (2026-10-15 사용자 요청)
  function fitVisible(bounds) {
    const K = kakao.maps;
    map.setBounds(bounds, ...padding());
    const proj = map.getProjection(), v = visibleBox();
    const sw = proj.containerPointFromCoords(bounds.getSouthWest()), ne = proj.containerPointFromCoords(bounds.getNorthEast());
    // 최대 축소에서 다 안 들어가면 카카오 setBounds 는 여백을 무시하고 가운데에 둔다 (제주가 시트 밑으로 5px 들어갔었다)
    // → 직접 보정: 들어가면 보이는 영역 가운데, 세로가 안 들어가면 남쪽 끝을 아래에, 가로가 안 들어가면 서쪽(본토·제주)을 왼쪽에
    //   (울릉도 같은 동쪽 끝·서울 쪽은 끌어서 본다)
    const dy = sw.y - ne.y > v.bottom - v.top - 24 ? sw.y - (v.bottom - 12) : (sw.y + ne.y) / 2 - (v.top + v.bottom) / 2;
    const dx = ne.x - sw.x > v.right - v.left - 24 ? sw.x - (v.left + 12) : (sw.x + ne.x) / 2 - (v.left + v.right) / 2;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      const c = proj.containerPointFromCoords(map.getCenter());
      map.setCenter(proj.coordsFromContainerPoint(new K.Point(c.x + dx, c.y + dy)));
    }
  }

  // 처음 화면 (위치 권한 없을 때): 수도권 — 서울·인천·수원이 다 보이게
  const CAPITAL = { s: 37.24, n: 37.70, w: 126.60, e: 127.12 };
  const START_ME_LEVEL = 7;              // 처음 화면 (위치 권한 있을 때): 내 위치 중심

  // 중심(lat, lon)에서 반경 km 가 다 보이는 범위 — 중심이 화면 가운데에 오도록 대칭으로 잡는다
  function circleBounds(lat, lon, km) {
    const K = kakao.maps;
    const dLat = km / 111, dLon = km / (111 * Math.cos(lat * Math.PI / 180));
    return new K.LatLngBounds(new K.LatLng(lat - dLat, lon - dLon), new K.LatLng(lat + dLat, lon + dLon));
  }

  // start: 처음 화면 (앱을 켤 때·처음 자동 위치 확인 때만) — 내 위치 레벨 7 또는 수도권. 그 밖에 '전체 지역'은 전국
  function fitTo(rows, { start = false } = {}) {
    const K = kakao.maps;
    const pts = rows.filter((r) => r.lat != null);
    if (state.near) {
      map.setBounds(circleBounds(state.near.lat, state.near.lon, state.radiusKm), ...padding());
      return;
    }
    if (state.me && !state.region) {
      if (start) {                          // 처음 화면: 내 위치 중심, 레벨 7
        map.setLevel(START_ME_LEVEL);
        centerVisible(new K.LatLng(state.me.lat, state.me.lon));
        return;
      }
      // 내 위치를 가운데에 두고, 반경이 있으면 그 원이, '전체'면 가장 가까운 3곳까지 보이게 (최대 5km)
      const nearest = pts.slice(0, 3).map((r) => r._dist).filter((d) => d != null);
      const km = state.meRadiusKm || Math.min(Math.max(...nearest, 0.4), 5);
      map.setBounds(circleBounds(state.me.lat, state.me.lon, km), ...padding());
      return;
    }
    if (start && !state.region) {            // 처음 화면 (위치 권한 없음): 수도권
      fitVisible(new K.LatLngBounds(new K.LatLng(CAPITAL.s, CAPITAL.w), new K.LatLng(CAPITAL.n, CAPITAL.e)));
      return;
    }
    if (!pts.length) return;
    if (pts.length === 1) { map.setLevel(4); centerVisible(new K.LatLng(pts[0].lat, pts[0].lon)); return; }
    const b = new K.LatLngBounds();
    for (const r of pts) b.extend(new K.LatLng(r.lat, r.lon));
    fitVisible(b);
  }

  function focusOn(r) {
    const K = kakao.maps;
    if (map.getLevel() > 5) map.setLevel(4, { animate: true });
    map.panTo(new K.LatLng(r.lat, r.lon));
    if (MOBILE.matches && state.sheet !== "full") {
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
      render({ fit: !!map && !state.near, start: !user && !state.touched });   // 처음 자동 확인이면 내 위치 레벨 7
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
    const wantView = name === "full" && state.selected == null ? "list" : "map";   // 상세를 펼친 건 '목록 보기'가 아님
    if (state.view !== wantView) {
      state.view = wantView;
      el.app.dataset.view = wantView;
      for (const b of el.viewSeg.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.view === wantView));
    }
  }

  // 시트 끌기 (휴대폰). 손잡이·'N곳' 줄은 바로 끌리고, 상세·목록 내용은 맨 위까지 스크롤된 상태에서 아래로 끌 때부터
  // 시트가 손가락을 따라온다 (내용이 스크롤돼 있으면 먼저 맨 위까지 올라간 뒤). 놓을 때:
  //  - 아래로 시트 높이의 20% 이상 끌었거나 빠르게 쓸어내렸으면 → 바로 닫힘 (중간 단계에서 멈추지 않음)
  //  - 위로 40px 이상 끌었거나 빠르게 쓸어올렸으면 → 다 펼침
  //  - 조금만 끌었으면 → 원래 높이로
  // 끈 직후의 click(상호명 링크 등)은 무시한다. 터치는 touch 이벤트(내용 스크롤과 같이 다루려고), 마우스는 pointer 이벤트
  const CLOSE_RATIO = 0.2, FLICK = 0.5;          // 닫힘: 높이의 20% / 빠르기 0.5px/ms (= 500px/s)
  let lastDragEnd = 0;

  function enableSheetDrag() {
    let g = null;                                 // 지금 손가락 하나의 제스처
    const offsetOf = (name) => sheetGeometry().offsets[name];
    const startDrag = (y) => {
      g.dragging = true;
      g.baseY = y;
      g.start = offsetOf(state.sheet);
      g.height = window.innerHeight - sheetGeometry().top - g.start;     // 지금 보이는 시트 높이
      el.panel.classList.add("dragging");
      el.app.classList.add("sheet-dragging");                           // 끄는 동안 앱 설치 띠 숨김
    };
    const follow = (y) => el.app.style.setProperty("--sheet-y", `${Math.max(0, g.start + y - g.baseY)}px`);
    const finish = (y) => {
      el.panel.classList.remove("dragging");
      el.app.classList.remove("sheet-dragging");
      lastDragEnd = Date.now();
      const dy = y - g.baseY;
      if (dy > 0 && (dy >= g.height * CLOSE_RATIO || (g.v > FLICK && dy > 10))) setSheet("closed");
      else if (dy < 0 && state.sheet !== "full" && (-dy >= 40 || (g.v < -FLICK && dy < -10))) setSheet("full");
      else setSheet(state.sheet);                                      // 조금만 끌었으면 제자리로
    };
    const tapHandle = () => setSheet(state.sheet === "closed" ? "half" : state.sheet === "half" ? "full" : "half");

    el.panel.addEventListener("touchstart", (e) => {
      if (!MOBILE.matches || e.touches.length !== 1) { g = null; return; }
      const t = e.touches[0];
      g = { y0: t.clientY, last: t.clientY, lastT: e.timeStamp, v: 0, dragging: false,
            handle: !!e.target.closest(".sheet-grip, .list-meta"), button: !!e.target.closest("button"),
            scroller: e.target.closest(".detail, .scroll") };
    }, { passive: true });
    el.panel.addEventListener("touchmove", (e) => {
      if (!g) return;
      const y = e.touches[0].clientY;
      const dt = Math.max(1, e.timeStamp - g.lastT);
      g.v = 0.6 * g.v + 0.4 * ((y - g.last) / dt);                    // 최근 빠르기 (px/ms, 아래가 +)
      const down = y > g.last;
      g.last = y; g.lastT = e.timeStamp;
      if (!g.dragging) {
        if (g.handle && Math.abs(y - g.y0) > 6) startDrag(y);
        else if (g.scroller && down && g.scroller.scrollTop <= 0 && y - g.y0 > 6) startDrag(y);   // 맨 위에서 아래로
      }
      if (g.dragging) {
        if (e.cancelable) e.preventDefault();                          // 내용 스크롤 대신 시트를 끈다
        follow(y);
      }
    }, { passive: false });
    const end = () => {
      if (!g) return;
      if (g.dragging) finish(g.last);
      else if (g.handle && !g.button && Math.abs(g.last - g.y0) <= 6) tapHandle();   // 손잡이·'N곳' 줄 탭
      g = null;
    };
    el.panel.addEventListener("touchend", end);
    el.panel.addEventListener("touchcancel", end);
    // 끈 직후 손을 뗀 자리의 click 은 무시 (상호명 링크가 열리거나 카드가 눌리지 않게)
    el.panel.addEventListener("click", (e) => {
      if (Date.now() - lastDragEnd < 400) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    // 마우스 (좁은 PC 창): 손잡이·'N곳' 줄만
    let m = null;
    for (const h of [el.grip, el.listMeta]) {
      h.addEventListener("pointerdown", (e) => {
        if (!MOBILE.matches || e.pointerType !== "mouse" || e.target.closest("button")) return;
        g = { y0: e.clientY, last: e.clientY, lastT: e.timeStamp, v: 0, dragging: false, handle: true };
        m = h;
        h.setPointerCapture?.(e.pointerId);
      });
      h.addEventListener("pointermove", (e) => {
        if (m !== h || !g) return;
        const dt = Math.max(1, e.timeStamp - g.lastT);
        g.v = 0.6 * g.v + 0.4 * ((e.clientY - g.last) / dt);
        g.last = e.clientY; g.lastT = e.timeStamp;
        if (!g.dragging && Math.abs(e.clientY - g.y0) > 4) startDrag(e.clientY);
        if (g.dragging) follow(e.clientY);
      });
      const up = () => { if (m === h) { m = null; end(); } };
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
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
    el.region.addEventListener("change", () => {
      state.region = el.region.value; state.touched = true; clearSubset(); closeDetail(); render({ fit: true });
    });
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
    el.famousBtn.addEventListener("click", () => {
      state.famousOnly = !state.famousOnly;
      clearSubset();
      closeDetail();
      render({ fit: true });
      if (state.famousOnly && visible().length === 0) toast("이 지역은 유명 유튜버 맛집이 아직 없어요");
    });
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
      if (a.dataset.action === "back") { closeDetail(); if (MOBILE.matches) setSheet("full"); }
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

  // ---------------------------------------------------------------- 안내 띠 (휴대폰): 인앱 브라우저 · 앱 설치
  // 한 번에 하나만 띄운다: 인앱 브라우저 안내 > 유튜브 첫 방문 안내 > 설치 안내. 앞의 것을 띄운 방문에는 그것을 닫아도
  // 다음 것을 띄우지 않고 다음 방문에 띄운다 (claimBanner). 앱으로 실행 중(standalone)이면 인앱·설치 안내는 없다.
  //  - 인앱 브라우저(카카오톡·네이버 앱·인스타그램·페이스북·라인·다음·에브리타임): 홈 화면 설치가 안 되므로 기본 브라우저로 보낸다.
  //    카카오톡은 kakaotalk://web/openExternal?url= (안드로이드·아이폰). 카카오 공식 문서에는 없고 DevTalk·개발자 글에서 널리
  //    쓰이는 방식이다 (2026-10-15 확인: 카카오는 'DevTalk 에서 외부 브라우저 이동은 지원하지 않음, 카카오톡 고객센터 문의' 답변뿐 —
  //    devtalk.kakao.com/t/topic/131149, /t/branch/151358). 그래서 1.5초 뒤에도 이 화면이 보이면 안 된 것으로 보고
  //    메뉴 안내 + [주소 복사] 로 바꾼다. 안드로이드 다른 인앱은 intent:// 로 크롬, 아이폰 다른 인앱은 웹에서 사파리를 여는 방법이 없어 안내만
  //  - 안드로이드 크롬 등: beforeinstallprompt 를 잡아 두었다가 [설치] → 바로 설치 창. 삼성 인터넷에서 3초 안에 안 오면 메뉴 안내
  //  - 아이폰 사파리: 설치 API 가 없어 '공유 → 홈 화면에 추가' 안내 / 아이폰 다른 브라우저: 사파리에서 열라는 안내 + [주소 복사]
  // 닫은 시각만 기기에 둔다 (인앱 7일 · 아이폰 설치 14일 · 안드로이드 설치 30일). 위치는 저장 안 함
  const INSTALL_DISMISSED = "matjip-install-dismissed", INSTALLED = "matjip-installed";
  const IOS_DISMISSED = "matjip-ios-install-dismissed", INAPP_DISMISSED = "matjip-inapp-dismissed";
  const DISMISS_DAYS = { [INSTALL_DISMISSED]: 30, [IOS_DISMISSED]: 14, [INAPP_DISMISSED]: 7 };
  const INAPP_UA = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|\bLine\/|DaumApps|everytimeApp/i;
  const IC_SHARE = `<svg class="ios-ic" viewBox="0 0 24 24" width="16" height="16" aria-label="공유" role="img"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v11M8 7l4-4 4 4M8 10H6v10h12V10h-2"/></svg>`;
  const INSTALL_TEXT = {
    prompt: "<b>맛도리를 홈 화면에 설치하기</b>주소창 없이 앱처럼 바로 열려요",
    samsung: "<b>맛도리를 홈 화면에 추가하기</b>메뉴(≡) → 「현재 페이지 추가」 → 「홈 화면」",
    ios: `<b>홈 화면에 추가하면 앱처럼 쓸 수 있어요</b>아래 ${IC_SHARE} → 「홈 화면에 추가」 <small>(공유가 안 보이면 ··· 먼저)</small>`,
    iosOther: "<b>사파리에서 열어야 설치할 수 있어요</b>주소를 복사해 Safari 에 붙여넣어 주세요",
  };
  const INAPP_TITLE = "<b>앱으로 설치하려면 기본 브라우저에서 열어주세요</b>";
  const INAPP_IOS_HELP = "오른쪽 아래(또는 위) ⋯ → 「다른 브라우저로 열기」 또는 「Safari로 열기」";
  const INAPP_ANDROID_HELP = "주소를 복사해 크롬에 붙여넣어 주세요";
  let installPrompt = null, installKind = null;

  const storeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 하면 이번만 */ } };

  function isStandalone() {
    return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches
      || navigator.standalone === true;                                   // 아이폰 홈 화면 앱
  }

  // 브라우저 종류 (user agent). 인앱이면 설치 안내 대신 인앱 안내. 아이폰은 사파리만 '홈 화면에 추가'가 된다고 안내
  function browserInfo(ua = navigator.userAgent || "", touch = navigator.maxTouchPoints || 0) {
    const os = /Android/i.test(ua) ? "android"
      : (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touch > 1)) ? "ios" : "pc";
    const inapp = INAPP_UA.test(ua);
    return {
      os, inapp, kakao: /KAKAOTALK/i.test(ua), samsung: /SamsungBrowser/.test(ua),
      safari: os === "ios" && !inapp && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Whale|DuckDuckGo/.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua),
    };
  }

  // 인앱 → 기본 브라우저로 여는 주소. 없으면(아이폰 기타 인앱) null
  function outsideUrl(info, href = location.href) {
    if (info.kakao) return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
    if (info.os === "android") {
      const u = new URL(href);
      return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;end`;
    }
    return null;
  }

  let bannerShown = null;                                  // 이번 방문에 띄운 안내 ('inapp' | 'notice' | 'install')
  function claimBanner(name) {
    if (bannerShown && bannerShown !== name) return false;
    bannerShown = name;
    return true;
  }
  function dismissedRecently(key) {
    const t = +storeGet(key);
    return t > 0 && Date.now() - t < DISMISS_DAYS[key] * 864e5;
  }

  // 휴대폰: 위쪽 안내(첫 방문·인앱)는 검색창·칩 바로 아래. 칩 줄은 데이터를 읽은 뒤에 그려져 높이가 나중에 바뀐다 → 바뀔 때마다 다시 맞춤
  // 안내가 떠 있는 동안 알림(토스트)은 그 아래로 (--notice-bottom, .has-top-notice)
  function placeTopNotice(node) {
    const place = () => {
      if (!MOBILE.matches) return;
      const top = Math.round(el.topbar.getBoundingClientRect().bottom) + 8;
      el.app.style.setProperty("--notice-top", `${top}px`);
      if (node.offsetHeight) el.app.style.setProperty("--notice-bottom", `${top + node.offsetHeight}px`);
    };
    place();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    ro?.observe(el.topbar);
    ro?.observe(node);
    addEventListener("resize", place);
    el.app.classList.add("has-top-notice");
    return () => { ro?.disconnect(); removeEventListener("resize", place); el.app.classList.remove("has-top-notice"); };
  }

  // 주소 복사 (? # 는 뺀다). 인앱 브라우저마다 클립보드 API 가 막혀 있거나 응답 없이 멈추기도 해서
  // 탭한 그 순간에 되는 textarea 복사를 먼저, 안 되면 클립보드 API 를 1초 제한으로
  async function copyUrl() {
    const url = location.origin + location.pathname;
    const t = document.createElement("textarea");
    t.value = url; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(t);
    t.select(); t.setSelectionRange(0, url.length);       // 아이폰은 select() 만으로는 선택이 안 된다
    let done = false;
    try { done = document.execCommand("copy"); } catch { done = false; }
    t.remove();
    if (!done && navigator.clipboard) {
      done = await Promise.race([navigator.clipboard.writeText(url).then(() => true, () => false),
                                 new Promise((res) => setTimeout(() => res(false), 1000))]);
    }
    toast(done ? "주소를 복사했어요. 브라우저 주소창에 붙여넣어 주세요" : `주소: ${url}`);
  }

  function showInapp(info) {
    if (dismissedRecently(INAPP_DISMISSED) || !claimBanner("inapp")) return false;
    const stop = placeTopNotice(el.inappBar);
    const help = (failed) => {                             // 자동 전환이 없거나 안 됐을 때: 메뉴 안내 + 주소 복사
      el.inappText.innerHTML = `${INAPP_TITLE}${info.os === "ios" ? INAPP_IOS_HELP : INAPP_ANDROID_HELP}`;
      el.inappOpen.hidden = true;
      el.inappCopy.hidden = false;
      el.inappBar.dataset.state = failed ? "failed" : "help";
    };
    const url = outsideUrl(info);
    if (url) {
      el.inappText.innerHTML = INAPP_TITLE;
      el.inappOpen.hidden = false;
      el.inappCopy.hidden = true;
      el.inappBar.dataset.state = "open";
      el.inappOpen.addEventListener("click", () => {
        location.href = url;
        setTimeout(() => { if (!document.hidden) help(true); }, 1500);   // 브라우저가 떴으면 이 화면은 가려져 있다
      });
    } else help(false);
    el.inappCopy.addEventListener("click", copyUrl);
    el.inappClose.addEventListener("click", () => {
      storeSet(INAPP_DISMISSED, String(Date.now()));
      el.inappBar.hidden = true;
      stop();
    });
    el.inappBar.hidden = false;
    return true;
  }

  function installSuppressed(kind) {
    if (isStandalone() || storeGet(INSTALLED)) return true;
    return dismissedRecently(kind === "ios" || kind === "iosOther" ? IOS_DISMISSED : INSTALL_DISMISSED);
  }

  function showInstall(kind) {
    if (installSuppressed(kind) || !claimBanner("install")) return;
    installKind = kind;
    el.installBar.dataset.kind = kind;
    el.installText.innerHTML = INSTALL_TEXT[kind];
    el.installGo.textContent = kind === "iosOther" ? "주소 복사" : "설치";
    el.installGo.hidden = kind !== "prompt" && kind !== "iosOther";
    el.installBar.hidden = false;
    el.app.classList.add("has-install");
  }

  function hideInstall() {
    el.installBar.hidden = true;
    el.app.classList.remove("has-install");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();                   // 크롬 기본 안내 대신 우리 띠 ([닫기] 했거나 다른 안내를 띄운 방문이면 아무것도 안 띄움)
    const info = browserInfo();
    if (info.inapp || info.os === "ios") return;   // 인앱·아이폰은 자기 안내가 따로 있다 (보통 이 이벤트가 오지도 않음)
    installPrompt = e;
    showInstall("prompt");                // 삼성 인터넷 메뉴 안내가 떠 있었으면 [설치] 띠로 바뀐다
  });
  window.addEventListener("appinstalled", () => {
    storeSet(INSTALLED, "1"); installPrompt = null; hideInstall();
    countEvent("app-install");                            // 안드로이드 크롬 등 (아이폰 사파리에는 이 이벤트가 없음)
  });

  // ---------------------------------------------------------------- 앱 설치·앱으로 연 횟수 (GoatCounter 이벤트, 화면에는 표시 안 함)
  // 숫자만 센다: 이벤트 이름만 보내고 기기 구분값·위치는 보내지 않는다. 로컬·확인용 주소에서는 index.html 로더가
  // count.js 를 안 불러와 window.goatcounter 가 없으므로 집계되지 않는다. 일일 요약(python -m matjip report)이 읽는다
  function countEvent(name) {
    if (!window.goatcounter) return;
    let tries = 0;
    const go = () => {                                    // count.js 가 늦게 뜰 수 있어 잠깐 기다린다 (최대 10초)
      if (typeof window.goatcounter.count === "function") window.goatcounter.count({ path: name, title: name, event: true });
      else if (++tries < 20) setTimeout(go, 500);
    };
    go();
  }
  const APP_OPEN = "matjip-app-open";                      // 앱으로 연 날짜(한국)를 기억 → 하루 한 번만 'app-open'
  const kstDay = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  function countAppOpen() {
    if (!isStandalone()) return;
    const day = kstDay();
    if (storeGet(APP_OPEN) === day) return;
    storeSet(APP_OPEN, day);
    countEvent("app-open");
  }

  function bindInstall() {
    // 띠 높이 → '마지막 업데이트'를 그 위로 (시트가 열려 있으면 띠가 숨겨져 0 이라, 보일 때마다 다시 잰다)
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        if (el.installBar.offsetHeight) el.app.style.setProperty("--install-h", `${el.installBar.offsetHeight}px`);
      }).observe(el.installBar);
    }
    el.installClose.addEventListener("click", () => {
      storeSet(installKind === "ios" || installKind === "iosOther" ? IOS_DISMISSED : INSTALL_DISMISSED, String(Date.now()));
      hideInstall();
    });
    el.installGo.addEventListener("click", async () => {
      if (installKind === "iosOther") return copyUrl();
      const p = installPrompt;
      if (!p) return hideInstall();
      installPrompt = null;               // prompt() 는 이벤트마다 한 번만 쓸 수 있다
      hideInstall();
      p.prompt();
      const { outcome } = await p.userChoice;
      if (outcome === "accepted") storeSet(INSTALLED, "1");  // 설치 창에서 취소하면 이번에만 숨김 (다음 방문 때 다시)
    });
    // 휴대폰 키보드가 올라오면(검색 입력 중) 띠를 숨긴다 — 검색창 아래·키보드 위에 떠서 입력을 가리지 않게
    const vv = window.visualViewport;
    const kbd = () => el.app.classList.toggle("kbd-open",
      document.activeElement === el.q || (!!vv && vv.height < window.innerHeight * 0.75));
    el.q.addEventListener("focus", kbd);
    el.q.addEventListener("blur", () => setTimeout(kbd, 0));
    vv?.addEventListener("resize", kbd);
  }

  // 순서대로 하나만: 인앱 안내 > 유튜브 첫 방문 안내 > 설치 안내 (안드로이드는 beforeinstallprompt 가 올 때 showInstall)
  function bindBanners() {
    const info = browserInfo();
    const standalone = isStandalone();
    if (!standalone && info.inapp && showInapp(info)) return;
    if (bindNotice()) return;
    if (standalone || info.inapp) return;                  // 앱 실행 중 / 인앱(설치가 안 되는 브라우저)이면 설치 안내 없음
    if (info.os === "ios") setTimeout(() => showInstall(info.safari ? "ios" : "iosOther"), 1200);
    else if (info.samsung) setTimeout(() => { if (!installPrompt) showInstall("samsung"); }, 3000);
  }

  // ---------------------------------------------------------------- 방문자 수 (GoatCounter 공개 카운터)
  // GoatCounter 사이트 설정의 'Allow adding visitor counts on your website' 를 켜야 숫자가 온다 (꺼져 있으면 403 → 숨김).
  // 로컬에서는 index.html 이 count.js 를 안 불러와 window.goatcounter 가 없으니 카운터도 안 보인다
  //
  // 공개 카운터의 성질 (GoatCounter 소스 handlers/vcounter.go, 2026-10-14 확인):
  //  - start·end 는 날짜만 받고 **UTC 0시**로 읽는다 (계정 시간대 Asia/Seoul 은 안 씀). end 는 그날 0시 전까지
  //    → 한국 날짜를 보내면 한국 0~9시에는 UTC 로 '내일'이라 늘 0 이었다. 그래서 UTC 날짜를 보낸다:
  //      '오늘' = 한국 시간 오전 9시부터 (한국 0~9시에는 어제 9시부터). 한국 자정 기준은 공개 카운터로는 표현할 수 없다
  //  - 같은 주소의 응답은 최대 4시간 저장돼(Expires +4h, 앞단 Varnish) 늦게 바뀐다. 모르는 파라미터는 저장 키에서 빠져
  //    소용없고, start·end 가 다르면 새로 계산한다 → end 를 15분마다 하루씩 미래로 바꿔(결과는 같음) 최대 15분 지연으로
  const VISITS_URL = "https://matdori.goatcounter.com/counter/TOTAL.json";
  const VISITS_BUCKET_MIN = 15;
  const utcDate = (t) => new Date(t).toISOString().slice(0, 10);
  function visitsRange(now = Date.now()) {
    const day = utcDate(now);
    const bucket = Math.floor((now % 864e5) / (VISITS_BUCKET_MIN * 6e4));           // 0 ~ 95 (UTC 하루 안의 15분 칸)
    const end = utcDate(Date.parse(`${day}T00:00:00Z`) + (1 + bucket) * 864e5);      // 내일 ~ 96일 뒤 (미래라 결과는 같음)
    return { today: `?start=${day}&end=${end}`, total: `?start=2000-01-01&end=${end}` };
  }

  // 카운터 서버(goatcounter.com) 연결이 끊길 때가 있다 (2026-10-15 PC·휴대폰에서 간헐적 'Failed to fetch').
  // 요청마다 8초 제한 + 두 번 더 시도, 그래도 실패하면 이 기기에 저장해 둔 마지막 숫자를 보여 준다 (없으면 그 줄만 숨김).
  // main() 은 이 함수를 기다리지 않으므로 페이지 로딩을 늦추지 않는다
  const VISITS_KEY = "matjip-visits";                     // 마지막으로 받은 {d: UTC 날짜, day, total} — 숫자만, 위치·기기 정보 없음
  const VISITS_TRIES = 3, VISITS_TIMEOUT = 8000;
  async function fetchCount(s) {
    for (let i = 0; i < VISITS_TRIES; i++) {
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctl && setTimeout(() => ctl.abort(), VISITS_TIMEOUT);
      try {
        const r = await fetch(VISITS_URL + s, ctl ? { signal: ctl.signal } : undefined);
        if (r.status === 403) return null;                // 카운터 공개 설정이 꺼짐 → 다시 해도 같음
        if (r.ok) {
          const d = await r.json();
          if (d && d.count != null) return String(d.count);
        }
      } catch { /* 연결 끊김·시간 초과 → 다시 */ } finally { if (timer) clearTimeout(timer); }
      if (i < VISITS_TRIES - 1) await new Promise((res) => setTimeout(res, 1500));
    }
    return null;
  }

  async function loadVisits() {
    if (!window.goatcounter) return;
    const q = visitsRange();
    const today = utcDate(Date.now());                    // 카운터의 '오늘'은 UTC 날짜 (visitsRange 와 같은 기준)
    let [day, total] = await Promise.all([fetchCount(q.today), fetchCount(q.total)]);
    let saved = null;
    try { saved = JSON.parse(storeGet(VISITS_KEY) || "null"); } catch { saved = null; }
    if (total != null) {
      if (day == null && saved && saved.d === today) day = saved.day;
      storeSet(VISITS_KEY, JSON.stringify({ d: today, day, total }));
    } else if (saved && saved.total != null) {            // 이번엔 못 받음 → 마지막으로 받은 숫자 (표시 문구는 똑같이)
      total = saved.total;
      day = saved.d === today ? saved.day : null;
    }
    if (total == null) return;                             // 받은 적도 없으면 그 줄만 숨김
    (el.updated.querySelector(".upd-main") || el.updated).insertAdjacentHTML("beforeend", `<span class="visits">${
      day != null ? ` · 오늘 방문 <b>${esc(day)}</b>` : ""} · 누적 <b>${esc(total)}</b></span>`);
    el.updated.hidden = false;
  }

  // ---------------------------------------------------------------- 시작
  // 첫 방문 안내: YouTube API Services 사용·약관·Google 개인정보처리방침 (Developer Policies III.A.2). [확인] 하면 다시 안 뜸
  // 띄웠으면 true (그 방문에는 설치 안내를 띄우지 않는다 — bindBanners)
  const NOTICE_KEY = "matjip-yt-notice";
  function bindNotice() {
    if (storeGet(NOTICE_KEY)) return false;
    if (!claimBanner("notice")) return false;
    const stop = placeTopNotice(el.ytNotice);   // 휴대폰: 검색창·칩 바로 아래
    el.ytNotice.hidden = false;
    el.ytNoticeOk.addEventListener("click", () => {
      storeSet(NOTICE_KEY, String(Date.now()));
      el.ytNotice.hidden = true;
      stop();
    });
    return true;
  }

  async function main() {
    bind();
    bindInstall();
    bindBanners();
    countAppOpen();
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
      el.updated.innerHTML = `<span class="upd-main">마지막 업데이트 <b>${+m}/${+day} ${esc(t || "")}</b></span>`
        + `<span class="credit credit-pill">${CREDIT} · ${ABOUT_LINK}<span class="copyright">${COPYRIGHT}</span></span>`;   // 휴대폰: 둘째 줄 제작자·이용 안내, 셋째 줄 저작권
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
      render({ fit: true, start: true });                // 처음 화면: 내 위치(권한 있으면) 또는 수도권
    } catch (e) {
      showMapMessage(e.message === "nokey"
        ? "<b>지도를 표시하려면 카카오 JavaScript 키가 필요해요</b><br>.env 에 KAKAO_JS_KEY 를 넣고 python -m matjip export 를 실행하세요"
        : "<b>카카오 지도를 불러오지 못했어요</b><br>키와 사이트 도메인 등록(카카오 개발자 콘솔)을 확인하세요");
      renderNear();
    }
  }

  window.matjipDebug = { state, routeLinks, visitsRange, clampCenter, KOREA, browserInfo, outsideUrl, banner: () => bannerShown,
                         level: () => map?.getLevel(), get map() { return map; } };
  main();
})();
