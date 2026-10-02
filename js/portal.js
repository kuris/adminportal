/* ============================================================
   통합 관리자 포털 (portal.js)  ·  admin.chatgpts.kr

   목적: 15개 서비스의 조회(트래픽) 통계를 한 화면에서 "전체 방향"으로 본다.

   - 접근: Google 로그인만. phiskim@gmail.com 외에는 화면을 열지 않습니다.
           (실제 데이터 경계는 서버 RLS public.cg_is_admin)
   - 데이터: public.page_views 하나에서 service 컬럼으로 전체를 집계합니다.
             SQL 변경 없이 동작하도록 최근 구간을 페이지네이션으로 모으고,
             전체 누적/기간 합계는 count 질의로 정확히 받습니다.
   - tracks=false 서비스(hanja/gram/science/cbt)는 아직 통합 로그에 없어
     "미집계"로 표시합니다.
   ============================================================ */

(function () {
  'use strict';

  // ---------- 상수 ----------
  var ADMIN_EMAIL = 'phiskim@gmail.com';

  var SERVICES = Array.isArray(window.PORTAL_SERVICES) ? window.PORTAL_SERVICES.slice() : [];
  var SVC_BY_KEY = {};
  SERVICES.forEach(function (s) { SVC_BY_KEY[s.key] = s; });

  // PostgREST max_rows = 1000. 최근 구간을 최대 40,000행까지 모읍니다.
  var PAGE_SIZE = 1000;
  var MAX_PAGES = 40;
  var WINDOW_DAYS = 120;      // 추이/차트/서비스별 집계에 쓰는 최근 조회창

  var sb = function () { return window.sbAdmin || null; };

  // ---------- 상태 ----------
  var currentUser = null;
  var accessGranted = false;
  var trendRange = 30;            // 14 | 30 | 90
  var STATE = {
    rows: [],
    hitCap: false,
    counts: {},
    svcTotal: {},
    profilesTotal: null,
    profilesToday: null
  };

  // ============================================================
  // 유틸
  // ============================================================
  function el(id) { return document.getElementById(id); }
  function setText(id, t) { var n = el(id); if (n) n.textContent = t; }
  function setHtml(id, h) { var n = el(id); if (n) n.innerHTML = h; }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString(); }

  // KST 기준 (track.js 와 동일: day/hour 는 KST 로 저장됨)
  function kstNow() { return new Date(Date.now() + 9 * 60 * 60 * 1000); }
  function kstDateStr(offsetDays) {
    var d = kstNow();
    if (offsetDays) d.setTime(d.getTime() + offsetDays * 86400000);
    return d.toISOString().slice(0, 10);
  }
  function dateRangeDesc(days) {
    var out = [];
    for (var i = 0; i < days; i++) out.push(kstDateStr(-i));
    return out;   // 오늘 → 과거
  }
  function shortDate(day) {
    var p = String(day || '').split('-');
    return p.length === 3 ? (p[1] + '/' + p[2]) : day;
  }

  function formatTimeAgo(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var diff = Date.now() - d.getTime();
    if (diff < 0) return '방금 전';
    var min = Math.floor(diff / 60000);
    if (min < 1) return '방금 전';
    if (min < 60) return min + '분 전';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + '시간 전';
    var days = Math.floor(hr / 24);
    if (days < 7) return days + '일 전';
    return d.toISOString().slice(0, 10);
  }

  function normalizePath(path) {
    var clean = String(path || '').replace(/^\/+/, '');
    if (clean === '' || clean.slice(-1) === '/') clean += 'index.html';
    else if (!/\.[a-zA-Z0-9]+$/.test(clean)) clean += '.html';
    return clean;
  }

  function pageTitleOf(path, fallback) {
    var clean = normalizePath(path);
    var map = window.PORTAL_PAGE_TITLES || {};
    return map[clean] || fallback || clean;
  }

  function svcOf(key) {
    return SVC_BY_KEY[key] || { key: key, name: key || '기타', emoji: '•', color: '#64748b', tracked: true };
  }

  function svcBadge(key) {
    var s = svcOf(key);
    return '<span class="portal-svc-badge" style="--dot:' + escapeHtml(s.color) + ';">' +
           '<span class="portal-dot"></span>' + escapeHtml(s.name) + '</span>';
  }

  function deltaHtml(cur, prev) {
    if (prev == null || prev <= 0) {
      return cur > 0
        ? '<span class="portal-delta is-new">신규</span>'
        : '<span class="portal-delta is-flat">—</span>';
    }
    var pct = Math.round(((cur - prev) / prev) * 1000) / 10;
    if (pct > 0) return '<span class="portal-delta is-up">▲ ' + pct + '%</span>';
    if (pct < 0) return '<span class="portal-delta is-down">▼ ' + Math.abs(pct) + '%</span>';
    return '<span class="portal-delta is-flat">0%</span>';
  }

  // ============================================================
  // 권한 / 로그인
  // ============================================================
  function showView(name) {
    ['portal-loading', 'portal-auth-view', 'portal-denied-view', 'portal-dashboard-view'].forEach(function (id) {
      var n = el(id);
      if (n) n.style.display = 'none';
    });
    var target = el(name);
    if (target) target.style.display = (name === 'portal-dashboard-view') ? 'block' : 'block';
  }

  function applyAccess(user) {
    currentUser = user || null;
    var email = (user && user.email ? user.email : '').toLowerCase().trim();

    if (!user) {
      accessGranted = false;
      showView('portal-auth-view');
      return;
    }
    if (email !== ADMIN_EMAIL) {
      accessGranted = false;
      showView('portal-denied-view');
      setText('denied-user-email', email || '(이메일 없음)');
      return;
    }
    if (accessGranted) return;
    accessGranted = true;
    showView('portal-dashboard-view');
    setText('portal-current-email', email);
    loadAll();
  }

  function showAuthMsg(text, type) {
    var n = el('portal-auth-msg');
    if (!n) return;
    n.className = 'admin-msg show ' + (type || 'info');
    n.textContent = text;
  }

  function bindAuth() {
    var googleBtn = el('portal-google-btn');
    if (googleBtn) {
      googleBtn.addEventListener('click', async function () {
        if (!sb()) { showAuthMsg('서버 연결을 준비하지 못했습니다.', 'error'); return; }
        try {
          showAuthMsg('Google 로그인 창으로 이동합니다...', 'info');
          var res = await sb().auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: location.origin + '/' }
          });
          if (res && res.error) throw res.error;
        } catch (e) {
          showAuthMsg((e && e.message) || 'Google 로그인에 실패했습니다.', 'error');
        }
      });
    }

    document.querySelectorAll('.js-portal-logout').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try { if (sb()) await sb().auth.signOut(); } catch (e) { /* 무시 */ }
        location.reload();
      });
    });
  }

  // ============================================================
  // 데이터 로딩
  // ============================================================
  function pv() { return sb().schema('public').from('page_views'); }

  async function countPageViews(apply) {
    var q = pv().select('*', { count: 'exact', head: true });
    if (apply) q = apply(q);
    var res = await q;
    if (res.error) throw res.error;
    return res.count || 0;
  }

  async function countProfiles(apply) {
    var q = sb().schema('public').from('profiles').select('*', { count: 'exact', head: true });
    if (apply) q = apply(q);
    var res = await q;
    if (res.error) throw res.error;
    return res.count || 0;
  }

  async function fetchRecentRows() {
    var from = kstDateStr(-(WINDOW_DAYS - 1));
    var rows = [];
    var hitCap = false;
    for (var page = 0; page < MAX_PAGES; page++) {
      var start = page * PAGE_SIZE;
      var end = start + PAGE_SIZE - 1;
      var res = await pv()
        .select('service,path,page_title,user_id,day,hour,created_at')
        .gte('day', from)
        .order('created_at', { ascending: false })
        .range(start, end);
      if (res.error) throw res.error;
      var data = res.data || [];
      if (data.length === 0) break;
      rows.push.apply(rows, data);
      if (data.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) hitCap = true;
    }
    return { rows: rows, hitCap: hitCap };
  }

  async function fetchServiceTotals() {
    var out = {};
    await Promise.all(SERVICES.filter(function (s) { return s.tracked; }).map(async function (s) {
      try {
        out[s.key] = await countPageViews(function (q) { return q.eq('service', s.key); });
      } catch (e) {
        out[s.key] = null;
      }
    }));
    return out;
  }

  async function loadAll() {
    if (!sb()) { renderFatal('Supabase 연결을 준비하지 못했습니다.'); return; }

    var today = kstDateStr(0);
    var weekFrom = kstDateStr(-6);
    var monthFrom = kstDateStr(-29);
    var prevWeekFrom = kstDateStr(-13), prevWeekTo = kstDateStr(-7);
    var prevMonthFrom = kstDateStr(-59), prevMonthTo = kstDateStr(-30);
    var yesterday = kstDateStr(-1);

    try {
      var jobs = await Promise.all([
        fetchRecentRows(),
        countPageViews(null),
        countPageViews(function (q) { return q.eq('day', today); }),
        countPageViews(function (q) { return q.gte('day', weekFrom); }),
        countPageViews(function (q) { return q.gte('day', monthFrom); }),
        countPageViews(function (q) { return q.gte('day', prevWeekFrom).lte('day', prevWeekTo); }),
        countPageViews(function (q) { return q.gte('day', prevMonthFrom).lte('day', prevMonthTo); }),
        countPageViews(function (q) { return q.eq('day', yesterday); }),
        fetchServiceTotals(),
        countProfiles(null).catch(function () { return null; }),
        countProfiles(function (q) { return q.gte('created_at', today + 'T00:00:00+09:00'); }).catch(function () { return null; })
      ]);

      STATE.rows = jobs[0].rows;
      STATE.hitCap = jobs[0].hitCap;
      STATE.counts = {
        total: jobs[1], today: jobs[2], week: jobs[3], month: jobs[4],
        prevWeek: jobs[5], prevMonth: jobs[6], yesterday: jobs[7],
        profilesTotal: jobs[9], profilesToday: jobs[10]
      };
      STATE.svcTotal = jobs[8];
    } catch (e) {
      console.warn('[portal] 데이터 조회 실패:', e && (e.message || e));
      renderFatal('데이터를 불러오지 못했습니다. page_views 테이블과 관리자 권한(RLS)을 확인해 주세요.');
      return;
    }

    renderAll();
  }

  // ============================================================
  // 집계
  // ============================================================
  function aggregate(rows) {
    var today = kstDateStr(0);
    var weekFrom = kstDateStr(-6);
    var monthFrom = kstDateStr(-29);

    var total = 0, todayC = 0, weekC = 0, monthC = 0;
    var hours = new Array(24).fill(0);
    var daysMap = {};
    var svc = {};   // key -> {today,week,month,window,users:{},last}
    var pages = {}; // service|path -> {...}

    rows.forEach(function (r) {
      var d = r.day || String(r.created_at || '').slice(0, 10);
      total++;
      if (d === today) todayC++;
      if (d >= weekFrom) weekC++;
      if (d >= monthFrom) monthC++;

      var h = Number(r.hour);
      if (!isNaN(h) && h >= 0 && h < 24) hours[h]++;

      daysMap[d] = (daysMap[d] || 0) + 1;

      var key = r.service || '기타';
      if (!svc[key]) svc[key] = { today: 0, week: 0, month: 0, window: 0, users: {}, last: null };
      var b = svc[key];
      b.window++;
      if (d === today) b.today++;
      if (d >= weekFrom) b.week++;
      if (d >= monthFrom) b.month++;
      if (r.user_id) b.users[r.user_id] = 1;
      if (!b.last || r.created_at > b.last) b.last = r.created_at;

      var p = normalizePath(r.path);
      var pk = key + '|' + p;
      if (!pages[pk]) pages[pk] = { service: key, path: p, title: r.page_title || '', count: 0, users: {}, last: r.created_at };
      var pb = pages[pk];
      pb.count++;
      if (r.user_id) pb.users[r.user_id] = 1;
      if (r.created_at > pb.last) pb.last = r.created_at;
    });

    return {
      total: total, today: todayC, week: weekC, month: monthC,
      hours: hours, daysMap: daysMap, svc: svc,
      pages: Object.keys(pages).map(function (k) { return pages[k]; })
    };
  }

  // ============================================================
  // 렌더
  // ============================================================
  function renderFatal(msg) {
    showView('portal-dashboard-view');
    setText('portal-current-email', '—');
    setHtml('portal-fatal', '<div class="admin-callout is-warn"><div class="admin-callout-icon">!</div>' +
      '<div class="admin-callout-body"><h4>데이터를 표시할 수 없습니다</h4><p>' + escapeHtml(msg) + '</p></div></div>');
  }

  function renderAll() {
    var agg = aggregate(STATE.rows);
    renderSummary(STATE.counts);
    renderTrend(agg);
    renderServiceTable(agg);
    renderServiceShare(agg);
    renderHourly(agg.hours);
    renderTopPages(agg.pages);
    renderRecent(STATE.rows);
    renderSystemNote();
  }

  function renderSummary(c) {
    setText('stat-total-pv', num(c.total) + '회');
    setText('stat-today-pv', num(c.today) + '회');
    setText('stat-week-pv', num(c.week) + '회');
    setText('stat-month-pv', num(c.month) + '회');

    setHtml('delta-today', deltaHtml(c.today, c.yesterday));
    setHtml('delta-week', deltaHtml(c.week, c.prevWeek));
    setHtml('delta-month', deltaHtml(c.month, c.prevMonth));

    setText('stat-profiles', c.profilesTotal == null ? '—' : num(c.profilesTotal) + '명');
    setText('stat-profiles-today', c.profilesToday == null ? '—' : '+' + num(c.profilesToday) + '명');
  }

  function renderTrend(agg) {
    var node = el('portal-trend');
    if (!node) return;

    var days = dateRangeDesc(trendRange); // 오늘 → 과거
    var chrono = days.slice().reverse();
    var values = chrono.map(function (d) { return agg.daysMap[d] || 0; });
    var maxVal = Math.max.apply(null, values.concat([1]));
    var step = Math.max(1, Math.ceil(chrono.length / 10));

    node.innerHTML = chrono.map(function (d, i) {
      var v = values[i];
      var pct = Math.max(v > 0 ? 3 : 0, Math.round((v / maxVal) * 100));
      var showLabel = (i % step === 0) || i === chrono.length - 1;
      return '<div class="portal-bar" title="' + escapeHtml(d) + ' · ' + num(v) + '회">' +
        '<span class="portal-bar-val">' + (v ? num(v) : '') + '</span>' +
        '<div class="portal-bar-fill" style="height:' + pct + '%"></div>' +
        '<span class="portal-bar-label">' + (showLabel ? escapeHtml(shortDate(d)) : '') + '</span>' +
        '</div>';
    }).join('');

    var sum = values.reduce(function (a, b) { return a + b; }, 0);
    setText('portal-trend-summary',
      '최근 ' + trendRange + '일 합계 ' + num(sum) + '회 · 일평균 ' + num(Math.round(sum / chrono.length)) + '회 · 최고 ' + num(maxVal) + '회');
  }

  function renderServiceTable(agg) {
    var tbody = el('portal-service-tbody');
    if (!tbody) return;

    var monthTotal = 0;
    SERVICES.forEach(function (s) { var b = agg.svc[s.key]; if (b) monthTotal += b.month; });
    if (monthTotal === 0) {
      SERVICES.forEach(function (s) { var b = agg.svc[s.key]; if (b) { /* noop */ } });
    }

    var list = SERVICES.map(function (s) {
      var b = agg.svc[s.key] || { today: 0, week: 0, month: 0, window: 0, last: null };
      return {
        svc: s,
        today: b.today, week: b.week, month: b.month,
        window: b.window, last: b.last,
        total: STATE.svcTotal[s.key]
      };
    });

    var prevWeekBySvc = {};
    STATE.rows.forEach(function (r) {
      var d = r.day || '';
      if (d >= kstDateStr(-13) && d <= kstDateStr(-7)) {
        var k = r.service || '기타';
        prevWeekBySvc[k] = (prevWeekBySvc[k] || 0) + 1;
      }
    });

    list.sort(function (a, b) {
      if (a.svc.tracked !== b.svc.tracked) return a.svc.tracked ? -1 : 1;
      return (b.month - a.month) || (b.window - a.window);
    });

    var shareMax = Math.max.apply(null, list.map(function (x) { return x.month; }).concat([1]));

    tbody.innerHTML = list.map(function (x) {
      var s = x.svc;
      if (!s.tracked) {
        return '<tr class="is-muted">' +
          '<td>' + svcBadge(s.key) + '</td>' +
          '<td colspan="5"><span class="admin-badge admin-badge-gray">미집계 · 통합 로그 미연결</span> ' +
          '<a href="' + escapeHtml(s.url) + '/admin" target="_blank" rel="noopener" class="portal-link">서비스 관리자 →</a></td>' +
          '</tr>';
      }
      var share = shareMax > 0 ? Math.round((x.month / shareMax) * 100) : 0;
      var prev = prevWeekBySvc[s.key] || 0;
      return '<tr>' +
        '<td>' + svcBadge(s.key) + '</td>' +
        '<td class="portal-num">' + num(x.today) + '</td>' +
        '<td class="portal-num">' + num(x.week) + ' ' + deltaHtml(x.week, prev) + '</td>' +
        '<td class="portal-num"><div class="portal-cell-bar"><div class="portal-cell-fill" style="width:' + share + '%;background:' + escapeHtml(s.color) + ';"></div></div>' + num(x.month) + '</td>' +
        '<td class="portal-num">' + (x.total == null ? '—' : num(x.total)) + '</td>' +
        '<td class="portal-soft">' + escapeHtml(formatTimeAgo(x.last)) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderServiceShare(agg) {
    var node = el('portal-service-share');
    if (!node) return;

    var items = SERVICES.filter(function (s) { return s.tracked; }).map(function (s) {
      var b = agg.svc[s.key];
      return { key: s.key, name: s.name, color: s.color, count: b ? b.month : 0 };
    }).sort(function (a, b) { return b.count - a.count; });

    var total = items.reduce(function (a, b) { return a + b.count; }, 0);
    if (total === 0) {
      node.innerHTML = '<div class="admin-empty"><div class="admin-empty-icon">∅</div><div>최근 30일 조회 기록이 없습니다.</div></div>';
      return;
    }

    node.innerHTML = items.map(function (it, i) {
      var share = Math.round((it.count / total) * 100);
      return '<div class="admin-page-rank-item">' +
        '<span class="admin-rank-num">' + (i + 1) + '</span>' +
        '<div class="admin-rank-info"><div class="admin-rank-title">' + escapeHtml(it.name) + '</div></div>' +
        '<div class="admin-rank-bar-bg" title="점유율 ' + share + '%"><div class="admin-rank-bar-fill" style="width:' + share + '%;background:' + escapeHtml(it.color) + ';"></div></div>' +
        '<span class="admin-rank-val">' + num(it.count) + '회 <small style="color:#64748b;font-weight:400;">(' + share + '%)</small></span>' +
        '</div>';
    }).join('') + '<div class="portal-share-foot">최근 30일 합계 ' + num(total) + '회</div>';
  }

  function renderHourly(hours) {
    var node = el('portal-hourly');
    if (!node) return;
    var maxVal = Math.max.apply(null, hours.concat([1]));
    if (maxVal <= 1 && hours.reduce(function (a, b) { return a + b; }, 0) === 0) {
      node.innerHTML = '<div class="admin-empty"><div class="admin-empty-icon">∅</div><div>아직 수집된 시간대 데이터가 없습니다.</div></div>';
      return;
    }
    node.innerHTML = hours.map(function (cnt, h) {
      var pct = Math.max(4, Math.round((cnt / maxVal) * 100));
      var isPeak = cnt === maxVal && cnt > 0;
      return '<div class="admin-hour-bar-wrap" title="' + h + '시: ' + num(cnt) + '회">' +
        '<span class="admin-hour-count">' + (cnt > 0 ? num(cnt) : '') + '</span>' +
        '<div class="admin-hour-bar' + (isPeak ? ' is-peak' : '') + '" style="height:' + pct + '%;"></div>' +
        '<span class="admin-hour-label">' + h + '</span>' +
        '</div>';
    }).join('');
  }

  function renderTopPages(pages) {
    var node = el('portal-top-pages');
    if (!node) return;
    if (!pages.length) {
      node.innerHTML = '<div class="admin-empty"><div class="admin-empty-icon">∅</div><div>아직 수집된 화면 기록이 없습니다.</div></div>';
      return;
    }
    var list = pages.slice().sort(function (a, b) { return b.count - a.count; }).slice(0, 12);
    node.innerHTML = list.map(function (p, i) {
      return '<div class="admin-feed-item">' +
        '<div class="portal-rank-left"><span class="admin-rank-num">' + (i + 1) + '</span>' +
        '<div><strong>' + escapeHtml(pageTitleOf(p.path, p.title)) + '</strong> ' +
        svcBadge(p.service) + '<br><span class="admin-feed-path">/' + escapeHtml(p.path) + '</span></div></div>' +
        '<span class="admin-rank-val">' + num(p.count) + '회 <small style="color:#94a3b8;">· ' + num(Object.keys(p.users).length) + '명</small></span>' +
        '</div>';
    }).join('');
  }

  function renderRecent(rows) {
    var node = el('portal-recent');
    if (!node) return;
    if (!rows.length) {
      node.innerHTML = '<div class="admin-empty"><div class="admin-empty-icon">∅</div><div>최근 방문 기록이 없습니다.</div></div>';
      return;
    }
    node.innerHTML = rows.slice(0, 25).map(function (r) {
      return '<div class="admin-feed-item">' +
        '<div><strong>' + escapeHtml(pageTitleOf(r.path, r.page_title)) + '</strong> ' + svcBadge(r.service) +
        '<br><span class="admin-feed-path">/' + escapeHtml(normalizePath(r.path)) + '</span></div>' +
        '<span class="admin-feed-time">' + escapeHtml(formatTimeAgo(r.created_at)) + '</span>' +
        '</div>';
    }).join('');
  }

  function renderSystemNote() {
    var untracked = SERVICES.filter(function (s) { return !s.tracked; }).map(function (s) { return s.name; }).join(', ');
    var html = '<div class="admin-info-grid">' +
      infoItem('데이터 소스', 'public.page_views') +
      infoItem('집계 서비스', SERVICES.filter(function (s) { return s.tracked; }).length + '개 / 전체 ' + SERVICES.length + '개') +
      infoItem('최근 조회창', '최근 ' + WINDOW_DAYS + '일 · 최대 ' + num(PAGE_SIZE * MAX_PAGES) + '행') +
      infoItem('Supabase', 'ybhiznlelnpwaicyoifa') +
      '</div>';
    html += '<div class="admin-callout is-warn"><div class="admin-callout-icon">!</div>' +
      '<div class="admin-callout-body"><h4>미집계 서비스</h4><p>' + escapeHtml(untracked) +
      ' 는 아직 public.page_views 에 기록하지 않아 통합 통계에서 제외됩니다. 각 서비스에 track.js 를 연결하거나 기존 기록을 이전하면 전체가 한 화면에 잡힙니다.</p></div></div>';
    if (STATE.hitCap) {
      html += '<div class="admin-callout"><div class="admin-callout-icon">i</div>' +
        '<div class="admin-callout-body"><h4>조회창이 가득 찼습니다</h4><p>최근 ' + WINDOW_DAYS +
        '일 조회가 ' + num(PAGE_SIZE * MAX_PAGES) + '행을 넘어 차트·서비스별 합계가 일부 잘렸을 수 있습니다. 상단 누적 수치는 count 기준으로 정확합니다.</p></div></div>';
    }
    setHtml('portal-system-note', html);
  }

  function infoItem(k, v) {
    return '<div class="admin-info-item"><div class="admin-info-key">' + escapeHtml(k) + '</div>' +
      '<div class="admin-info-val">' + escapeHtml(v) + '</div></div>';
  }

  // ============================================================
  // 인터랙션
  // ============================================================
  function bindTrendRange() {
    var btns = document.querySelectorAll('#portal-trend-range .admin-pill-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        trendRange = parseInt(btn.dataset.range, 10) || 30;
        renderTrend(aggregate(STATE.rows));
      });
    });
  }

  function bindRefresh() {
    var btn = el('portal-refresh-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 갱신 중';
      loadAll().finally(function () {
        setTimeout(function () {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 새로고침';
        }, 300);
      });
    });
  }

  // ============================================================
  // boot
  // ============================================================
  function boot() {
    bindAuth();
    bindTrendRange();
    bindRefresh();

    if (!sb()) {
      showView('portal-auth-view');
      showAuthMsg('Supabase 연결을 준비하지 못했습니다. 네트워크 상태를 확인해 주세요.', 'error');
      return;
    }

    sb().auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      applyAccess(session && session.user ? session.user : null);
    }, function () {
      applyAccess(null);
    });

    sb().auth.onAuthStateChange(function (event, session) {
      applyAccess(session && session.user ? session.user : null);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
