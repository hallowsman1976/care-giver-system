/* ============================================================================
 * ระบบดูแลผู้มีภาวะพึ่งพิงในชุมชน — Frontend (app.js)
 * ----------------------------------------------------------------------------
 * SECTION 4 (Frontend Foundation):
 *   - CONFIG + ตัวเชื่อม API (เลี่ยง CORS preflight)
 *   - ระบบ Login + จัดการ session (localStorage)
 *   - Layout: Sidebar (desktop) / Bottom Nav (mobile) / Drawer / Header
 *   - Router สลับหน้า + เมนูตามสิทธิ์
 *   - Loading Overlay + SweetAlert2 helpers
 *   - หน้า Dashboard (Admin / Member) ทำงานจริง
 *   - หน้าอื่น ๆ เป็น placeholder รอเติมใน Section ถัดไป
 * ========================================================================== */

// ===============================
// CONFIG
// ===============================
const CONFIG = {
  // 🔴 วาง URL ของ Google Apps Script Web App ที่ Deploy แล้วตรงนี้
  // ตัวอย่าง: 'https://script.google.com/macros/s/AKfycbx..../exec'
  API_URL: 'https://script.google.com/macros/s/AKfycbwvXs1IUVSwzYNC6i_UxZNcs-vlpo9uANaEpPyzXW_XROoOlZBX7cRemLSxdPs0kYaQ/exec',

  SESSION_KEY: 'care_session_v1',
  SYSTEM_NAME: 'ระบบดูแลผู้มีภาวะพึ่งพิงในชุมชน',
};


// ===============================
// STATE (Session)
// ===============================
let SESSION = null; // { token, user: { userId, username, fullName, role, caregiverCode } }

function saveSession(s) {
  SESSION = s;
  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(s));
}
function loadSession() {
  try {
    const raw = localStorage.getItem(CONFIG.SESSION_KEY);
    SESSION = raw ? JSON.parse(raw) : null;
  } catch (e) { SESSION = null; }
  return SESSION;
}
function clearSession() {
  SESSION = null;
  localStorage.removeItem(CONFIG.SESSION_KEY);
}
function getToken() { return SESSION ? SESSION.token : ''; }
function getUser()  { return SESSION ? SESSION.user : null; }
function isAdmin()  { return getUser() && getUser().role === 'admin'; }


// ===============================
// UI HELPERS
// ===============================
function $(sel) { return document.querySelector(sel); }
function $id(id) { return document.getElementById(id); }

/** ป้องกัน XSS เวลาแทรกข้อความลง HTML */
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** วาดไอคอน Lucide ใหม่หลัง render */
function refreshIcons() {
  if (window.lucide && lucide.createIcons) lucide.createIcons();
}

let _loadingCount = 0;
function showLoading(text) {
  _loadingCount++;
  $id('loadingText').textContent = text || 'กำลังโหลด...';
  $id('loadingOverlay').classList.add('show');
}
function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) $id('loadingOverlay').classList.remove('show');
}

// SweetAlert2 wrappers
function toast(message, icon) {
  Swal.fire({
    toast: true, position: 'top', timer: 2200, showConfirmButton: false,
    icon: icon || 'success', title: message,
    customClass: { popup: 'font-sans' }
  });
}
function alertError(message) {
  Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: message, confirmButtonColor: '#2563EB', customClass: { popup: 'font-sans' } });
}
function alertSuccess(message) {
  Swal.fire({ icon: 'success', title: 'สำเร็จ', text: message, confirmButtonColor: '#2563EB', customClass: { popup: 'font-sans' } });
}
function confirmDialog(opts) {
  return Swal.fire({
    icon: opts.icon || 'warning',
    title: opts.title || 'ยืนยันการทำรายการ',
    text: opts.text || '',
    showCancelButton: true,
    confirmButtonText: opts.confirmText || 'ยืนยัน',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: opts.danger ? '#EF4444' : '#2563EB',
    cancelButtonColor: '#94A3B8',
    customClass: { popup: 'font-sans' }
  }).then(r => r.isConfirmed);
}


// ===============================
// API LAYER (เลี่ยง CORS preflight)
// ===============================

/**
 * เรียก API แบบดิบ — ส่ง body เป็น text (ไม่ตั้ง Content-Type) จึงเป็น "simple request"
 * ทำให้เบราว์เซอร์ไม่ส่ง OPTIONS preflight (ซึ่ง Apps Script จัดการไม่ได้)
 */
async function apiRaw(action, data) {
  if (!CONFIG.API_URL || CONFIG.API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL') {
    throw new Error('ยังไม่ได้ตั้งค่า API_URL ใน app.js');
  }
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: action, token: getToken(), data: data || {} }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับสถานะ ' + res.status);
  return res.json();
}

/**
 * เรียก API แบบมาตรฐาน — เปิด/ปิด loading, จัดการ session หมดอายุ, แจ้ง error อัตโนมัติ
 * @param {string} action
 * @param {object} data
 * @param {object} opts { loading: true, silent: false, loadingText }
 * @return {object} response { success, message, data }
 */
async function api(action, data, opts) {
  opts = opts || {};
  const useLoading = opts.loading !== false;
  try {
    if (useLoading) showLoading(opts.loadingText);
    const result = await apiRaw(action, data);

    // ตรวจ session หมดอายุ → เด้งกลับหน้า login
    if (result && result.success === false && /เซสชัน|เข้าสู่ระบบก่อน/.test(result.message || '')) {
      if (action !== 'login') {
        clearSession();
        renderLogin();
        toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'warning');
        return result;
      }
    }

    if (!result.success && !opts.silent) alertError(result.message || 'ทำรายการไม่สำเร็จ');
    return result;
  } catch (err) {
    if (!opts.silent) alertError(err.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    return { success: false, message: err.message, data: null };
  } finally {
    if (useLoading) hideLoading();
  }
}


// ===============================
// DATE HELPERS
// ===============================

/** แปลงวันที่เป็น dd/MM/yyyy (ปี พ.ศ.) */
function formatThaiDate(value) {
  if (!value) return '-';
  const d = parseDate(value);
  if (!d) return String(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * แปลงค่าเวลาให้เป็น HH:mm (เวลาไทย)
 * รองรับทั้งกรณีเป็น "HH:mm" อยู่แล้ว และกรณีที่ Google Sheets
 * แปลงช่องเวลาเป็นวันที่ epoch (เช่น 1899-12-30T02:30:56.000Z)
 */
function formatTime(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  // เป็น HH:mm หรือ HH:mm:ss อยู่แล้ว (ไม่ใช่ ISO datetime)
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m && s.indexOf('T') === -1) return m[1].padStart(2, '0') + ':' + m[2];
  // เป็น ISO datetime → จัดรูปแบบเป็นเวลาไทย
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    try {
      return d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2);
    }
  }
  return s;
}
/** วันที่วันนี้รูปแบบ yyyy-MM-dd (ใช้กับ input[type=date]) */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


// ===============================
// DATE PICKER (Flatpickr แสดงปี พ.ศ.) + THEME
// ===============================
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DATE_CLS_LG = 'w-full h-12 px-3.5 rounded-xl border border-line bg-bg text-ink outline-none focus:border-primary cursor-pointer';
const DATE_CLS_SM = 'w-full h-11 px-3 rounded-xl border border-line bg-bg text-ink outline-none focus:border-primary cursor-pointer';

/**
 * ติดตั้ง Flatpickr บนช่องวันที่ — เก็บค่าจริงเป็น Y-m-d (ค.ศ.) แต่แสดงผลเป็นปี พ.ศ.
 * @param {string} id  id ของ input
 * @param {object} opts  ตัวเลือกเพิ่มเติม (เช่น onChange, altInputClass)
 */
function fpInit(id, opts) {
  const el = $id(id);
  if (!el || !window.flatpickr) return;
  if (el._flatpickr) el._flatpickr.destroy();
  flatpickr(el, Object.assign({
    locale: (window.flatpickr && flatpickr.l10ns && flatpickr.l10ns.th) ? 'th' : 'default',
    dateFormat: 'Y-m-d',         // ค่าที่เก็บจริง (ส่งให้ backend)
    altInput: true,
    altFormat: 'PHT',            // sentinel → จัดรูปแบบ พ.ศ. เองใน formatDate
    altInputClass: DATE_CLS_LG,
    disableMobile: true,         // ใช้ปฏิทิน Flatpickr บนมือถือเพื่อให้แสดงปี พ.ศ. ได้
    formatDate: (date, format) => {
      if (format === 'PHT') {
        const d = String(date.getDate()).padStart(2, '0');
        const m = THAI_MONTHS_SHORT[date.getMonth()];
        const y = date.getFullYear() + 543;
        return `${d} ${m} ${y}`;
      }
      return flatpickr.formatDate(date, format);
    }
  }, opts || {}));
}

/** ใช้ธีม (สว่าง/มืด) + สลับไอคอน */
function applyTheme(t) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  const ic = $id('themeIcon');
  if (ic) { ic.setAttribute('data-lucide', t === 'dark' ? 'sun' : 'moon'); refreshIcons(); }
}
function toggleTheme() {
  const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
  localStorage.setItem('care_theme', next);
  applyTheme(next);
}


// ===============================
// MENU DEFINITIONS (ตามสิทธิ์)
// ===============================
const MENUS = {
  admin: [
    { key: 'dashboard',   label: 'Dashboard',            icon: 'layout-dashboard', primary: true },
    { key: 'caregivers',  label: 'จัดการ Care Giver',     icon: 'user-cog',         primary: true },
    { key: 'patients',    label: 'จัดการผู้พึ่งพิง',       icon: 'users',            primary: true },
    { key: 'assign',      label: 'มอบหมายการดูแล',        icon: 'clipboard-list',   primary: true },
    { key: 'dailyReport', label: 'รายงานรายวัน',          icon: 'calendar-days' },
    { key: 'monthlyReport', label: 'รายงานรายเดือน',      icon: 'calendar-range' },
    { key: 'history',     label: 'ประวัติการเยี่ยม',       icon: 'history' },
    { key: 'settings',    label: 'ตั้งค่าระบบ',            icon: 'settings' },
  ],
  member: [
    { key: 'dashboard',   label: 'หน้าหลัก',              icon: 'layout-dashboard', primary: true },
    { key: 'assigned',    label: 'เคสที่ได้รับมอบหมาย',    icon: 'users',            primary: true },
    { key: 'visitForm',   label: 'บันทึกการเยี่ยม',        icon: 'file-plus-2',      primary: true },
    { key: 'history',     label: 'ประวัติการเยี่ยม',       icon: 'history',          primary: true },
    { key: 'profile',     label: 'โปรไฟล์ของฉัน',         icon: 'user',             primary: true },
  ],
};

function currentMenu() { return MENUS[isAdmin() ? 'admin' : 'member']; }
function menuLabel(key) {
  const item = currentMenu().find(m => m.key === key);
  return item ? item.label : key;
}


// ===============================
// AUTH
// ===============================
function renderLogin() {
  $id('appShell').classList.add('hidden');
  $id('loginView').classList.remove('hidden');
  refreshIcons();
}

function renderApp() {
  $id('loginView').classList.add('hidden');
  $id('appShell').classList.remove('hidden');
  buildLayout();
  navigate('dashboard');
}

async function handleLogin(e) {
  e.preventDefault();
  const username = $id('loginUsername').value.trim();
  const password = $id('loginPassword').value;

  if (!username || !password) {
    return alertError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  }

  const res = await api('login', { username, password }, { loadingText: 'กำลังเข้าสู่ระบบ...' });
  if (res.success) {
    saveSession({ token: res.data.token, user: res.data.user });
    $id('loginForm').reset();
    toast('ยินดีต้อนรับ ' + (res.data.user.fullName || res.data.user.username));
    renderApp();
  }
}

async function logout() {
  const ok = await confirmDialog({ title: 'ออกจากระบบ?', text: 'คุณต้องการออกจากระบบใช่หรือไม่', confirmText: 'ออกจากระบบ', danger: true, icon: 'question' });
  if (!ok) return;
  clearSession();
  closeDrawer();
  renderLogin();
}


// ===============================
// LAYOUT (Sidebar / Bottom Nav / Drawer / Header)
// ===============================
function buildLayout() {
  const user = getUser();
  // Header
  $id('hdrName').textContent = user.fullName || user.username;
  $id('hdrRole').textContent = isAdmin() ? 'ผู้ดูแลระบบ' : ('Care Giver' + (user.caregiverCode ? ' · ' + user.caregiverCode : ''));
  $id('hdrAvatar').textContent = (user.fullName || user.username || 'U').trim().charAt(0).toUpperCase();

  const menu = currentMenu();

  // Sidebar (desktop) + Drawer (mobile) ใช้เมนูเต็มเหมือนกัน
  const fullMenuHtml = menu.map(navButtonHtml).join('');
  $id('sidebarMenu').innerHTML = fullMenuHtml;
  $id('drawerMenu').innerHTML = menu.map(m => navButtonHtml(m, true)).join('');

  // Bottom Nav (mobile): แสดง primary สูงสุด 4 + ปุ่ม "เพิ่มเติม" ถ้ามีเกิน
  const primary = menu.filter(m => m.primary);
  let bottomItems = primary.slice(0, primary.length > 5 ? 4 : 5);
  const bottomHtml = bottomItems.map(bottomItemHtml).join('');
  const moreHtml = (menu.length > bottomItems.length)
    ? `<button onclick="openDrawer()" class="bottom-item flex-1 flex flex-col items-center justify-center gap-0.5 text-muted">
         <i data-lucide="menu" class="w-5 h-5"></i><span class="text-[10px]">เพิ่มเติม</span></button>`
    : '';
  $id('bottomNav').innerHTML = bottomHtml + moreHtml;

  refreshIcons();
}

function navButtonHtml(m, inDrawer) {
  const onclick = inDrawer ? `navigate('${m.key}'); closeDrawer();` : `navigate('${m.key}')`;
  return `<button data-nav="${m.key}" onclick="${onclick}"
      class="nav-item w-full h-11 px-3 rounded-xl flex items-center gap-3 text-ink font-400 hover:bg-subtle text-left">
      <i data-lucide="${m.icon}" class="w-5 h-5 text-muted"></i>
      <span class="text-sm">${esc(m.label)}</span>
    </button>`;
}
function bottomItemHtml(m) {
  return `<button data-bottom="${m.key}" onclick="navigate('${m.key}')"
      class="bottom-item flex-1 flex flex-col items-center justify-center gap-0.5 text-muted">
      <i data-lucide="${m.icon}" class="w-5 h-5"></i>
      <span class="text-[10px] leading-none">${esc(m.label.length > 8 ? m.label.slice(0, 7) + '…' : m.label)}</span>
    </button>`;
}

function openDrawer() { $id('drawer').classList.add('show'); $id('drawerBackdrop').classList.add('show'); }
function closeDrawer() { $id('drawer').classList.remove('show'); $id('drawerBackdrop').classList.remove('show'); }


// ===============================
// ROUTER
// ===============================
let CURRENT_VIEW = null;
let ROUTE_PARAMS = {};

function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.getAttribute('data-nav') === key));
  document.querySelectorAll('[data-bottom]').forEach(el => el.classList.toggle('active', el.getAttribute('data-bottom') === key));
}

/**
 * เปลี่ยนหน้า
 * @param {string} key  คีย์เมนู/หน้า
 * @param {object} params  พารามิเตอร์เพิ่มเติม (เช่น patientId)
 */
function navigate(key, params) {
  CURRENT_VIEW = key;
  ROUTE_PARAMS = params || {};
  setActiveNav(key);
  $id('pageTitle').textContent = menuLabel(key);
  window.scrollTo(0, 0);

  const view = VIEWS[key];
  const container = $id('viewContainer');
  if (!view) {
    container.innerHTML = placeholderCard('ไม่พบหน้า: ' + esc(key));
    refreshIcons();
    return;
  }
  // รองรับทั้ง sync และ async
  Promise.resolve(view(container, ROUTE_PARAMS)).catch(err => {
    container.innerHTML = placeholderCard('โหลดหน้าไม่สำเร็จ: ' + esc(err.message));
    refreshIcons();
  });
}

function placeholderCard(text, sub) {
  return `<div class="bg-card rounded-2xl shadow-card p-8 text-center">
      <div class="w-14 h-14 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
        <i data-lucide="construction" class="w-7 h-7 text-primary"></i>
      </div>
      <div class="font-500 text-ink">${text}</div>
      ${sub ? `<div class="text-sm text-muted mt-1">${sub}</div>` : ''}
    </div>`;
}


// ===============================
// VIEWS
// ===============================
const VIEWS = {
  dashboard: viewDashboard,
  // หน้าที่จะเติมใน Section ถัดไป
  caregivers:    viewCaregivers,
  patients:      viewPatients,
  assign:        viewAssign,
  dailyReport:   viewDailyReport,
  monthlyReport: viewMonthlyReport,
  history:       viewHistory,
  settings:      viewSettings,
  assigned:      viewAssigned,
  visitForm:     viewVisitForm,
  profile:       viewProfile,
};

function placeholder(container, name) {
  container.innerHTML = placeholderCard(name, 'หน้านี้จะพัฒนาใน Section ถัดไป');
  refreshIcons();
}


// ---------- DASHBOARD ----------
async function viewDashboard(container) {
  container.innerHTML = dashSkeleton();
  const [sumRes, fuRes] = await Promise.all([
    api('getDashboardSummary', {}, { loading: false }),
    api('getFollowupCases', {}, { loading: false, silent: true })
  ]);
  if (!sumRes.success) { container.innerHTML = placeholderCard('โหลดข้อมูลไม่สำเร็จ'); refreshIcons(); return; }
  const d = sumRes.data;
  const followup = (fuRes && fuRes.success) ? (fuRes.data.cases || []) : [];
  const special = (fuRes && fuRes.success) ? (fuRes.data.specialFollowup || 0) : 0;

  container.innerHTML = (d.role === 'admin')
    ? renderAdminDashboard(d, followup, special)
    : renderMemberDashboard(d, followup, special);
  refreshIcons();
  animateDashCounters();
}

function dashSkeleton() {
  let s = '<div class="dash-glass rounded-3xl h-44 mb-5 animate-pulse"></div><div class="grid grid-cols-2 lg:grid-cols-4 gap-4">';
  for (let i = 0; i < 4; i++) s += '<div class="dash-glass rounded-3xl h-32 animate-pulse"></div>';
  return s + '</div>';
}

function animateDashCounters() {
  document.querySelectorAll('.dash-counter').forEach(el => {
    const target = +el.getAttribute('data-target') || 0, dur = 900, t0 = performance.now();
    const step = (t) => { const p = Math.min((t - t0) / dur, 1); el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

function statCard(label, value, icon, color) {
  return `<div class="bg-card rounded-2xl shadow-card p-4 flex items-center gap-3">
      <div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style="background:${color}1A">
        <i data-lucide="${icon}" class="w-6 h-6" style="color:${color}"></i>
      </div>
      <div class="min-w-0">
        <div class="text-2xl font-600 text-ink leading-none">${value}</div>
        <div class="text-xs text-muted mt-1 truncate">${esc(label)}</div>
      </div>
    </div>`;
}

function renderAdminDashboard(d, followup, special) {
  return dashHero({
    badge: 'ระบบพร้อมใช้งาน',
    title: 'Care Dashboard',
    desc: 'ระบบติดตามการดูแล บันทึกการเยี่ยม และวิเคราะห์ข้อมูลผู้มีภาวะพึ่งพิงในชุมชน',
    btnLabel: 'นำเข้า Excel หรือ CSV', btnIcon: 'upload-cloud', btnAction: "navigate('settings')",
    mini: [
      { v: d.totalPatients, l: 'ผู้ป่วย (คน)' },
      { v: d.totalCareGivers, l: 'Care Giver (คน)' },
      { v: d.visitsThisMonth, l: 'เยี่ยมเดือนนี้' }
    ]
  })
    + dashQuick([
      { icon: 'user-plus', tone: 'blue', title: 'เพิ่มผู้มีภาวะพึ่งพิง', sub: 'ลงทะเบียนผู้ป่วยรายใหม่เข้าระบบ', action: "navigate('patients')" },
      { icon: 'sliders-horizontal', tone: 'emerald', title: 'ตั้งค่าโปรไฟล์ระบบ', sub: 'ชื่อระบบ โฟลเดอร์รูป และการเชื่อมต่อ', action: "navigate('settings')" }
    ])
    + dashProcess()
    + dashSectionTitle('ภาพรวมสถิติ')
    + dashStatGrid([
      { label: 'ผู้ป่วยทั้งหมด', value: d.totalPatients, unit: 'คน', icon: 'users', tone: 'blue', sub: 'มอบหมายแล้ว ' + d.assignedPatients + ' คน' },
      { label: 'Care Giver ทั้งหมด', value: d.totalCareGivers, unit: 'คน', icon: 'user-cog', tone: 'sky', sub: 'พร้อมดูแล' },
      { label: 'รายงานการเยี่ยมเดือนนี้', value: d.visitsThisMonth, unit: 'ครั้ง', icon: 'clipboard-check', tone: 'emerald', sub: 'วันนี้ ' + d.visitsToday + ' ครั้ง' },
      { label: 'ผู้ป่วยที่ต้องติดตามพิเศษ', value: special, unit: 'คน', icon: 'alert-triangle', tone: 'rose', sub: special ? 'ต้องเยี่ยมด่วน' : 'ไม่มีเคสด่วน' }
    ])
    + dashFollowupSection(followup);
}

function renderMemberDashboard(d, followup, special) {
  const me = getUser();
  return dashHero({
    badge: 'พร้อมดูแล',
    title: 'สวัสดี ' + (me.fullName || me.username || ''),
    desc: 'บันทึกการเยี่ยมและติดตามเคสที่คุณรับผิดชอบในชุมชน',
    btnLabel: 'บันทึกการเยี่ยม', btnIcon: 'file-plus-2', btnAction: "navigate('visitForm')",
    mini: [
      { v: d.assignedCount, l: 'เคสที่รับ' },
      { v: d.visitedToday, l: 'เยี่ยมวันนี้' },
      { v: d.visitsThisMonth, l: 'เยี่ยมเดือนนี้' }
    ]
  })
    + dashQuick([
      { icon: 'file-plus-2', tone: 'blue', title: 'บันทึกการเยี่ยม', sub: 'ลงบันทึกการเยี่ยมผู้ป่วย', action: "navigate('visitForm')" },
      { icon: 'users', tone: 'emerald', title: 'เคสของฉัน', sub: 'ดูเคสที่ได้รับมอบหมาย', action: "navigate('assigned')" }
    ])
    + dashSectionTitle('ภาพรวมของฉัน')
    + dashStatGrid([
      { label: 'เคสที่รับมอบหมาย', value: d.assignedCount, unit: 'คน', icon: 'users', tone: 'blue' },
      { label: 'เยี่ยมแล้ววันนี้', value: d.visitedToday, unit: 'คน', icon: 'calendar-check', tone: 'emerald' },
      { label: 'ยังไม่ได้เยี่ยม', value: d.notVisitedToday, unit: 'คน', icon: 'calendar-x', tone: 'amber' },
      { label: 'เยี่ยมเดือนนี้', value: d.visitsThisMonth, unit: 'ครั้ง', icon: 'calendar-range', tone: 'sky' }
    ])
    + dashFollowupSection(followup);
}

// ---------- Glass dashboard components ----------
const DASH_TONES = {
  blue: 'bg-blue-500/10 text-blue-600', sky: 'bg-sky-500/10 text-sky-500',
  emerald: 'bg-emerald-500/10 text-emerald-600', rose: 'bg-rose-500/10 text-rose-500',
  amber: 'bg-amber-500/10 text-amber-600',
};
const DASH_SUBTONE = { blue: 'text-blue-600', sky: 'text-sky-500', emerald: 'text-emerald-600', rose: 'text-rose-500', amber: 'text-amber-600' };

function dashHero(o) {
  return `<section class="relative overflow-hidden rounded-3xl dash-hero text-white p-6 sm:p-7 mb-5 shadow-xl dash-anim">
      <div class="absolute -top-16 -right-10 w-52 h-52 rounded-full bg-white/10 blur-2xl"></div>
      <div class="absolute -bottom-20 -left-8 w-56 h-56 rounded-full bg-emerald-300/20 blur-2xl"></div>
      <div class="relative">
        <span class="inline-flex items-center gap-2 bg-white/20 backdrop-blur px-3 py-1.5 rounded-full text-xs font-500 mb-3"><span class="live-dot2"></span> ${esc(o.badge)}</span>
        <h1 class="text-2xl sm:text-3xl font-700 leading-tight">${esc(o.title)}</h1>
        <p class="text-white/85 text-sm mt-2 max-w-xl">${esc(o.desc)}</p>
        <button onclick="${o.btnAction}" class="press mt-4 inline-flex items-center gap-2 bg-white text-blue-600 font-600 text-sm px-5 h-11 rounded-2xl shadow-lg hover:shadow-xl transition">
          ${o.btnIcon ? `<i data-lucide="${o.btnIcon}" class="w-5 h-5"></i>` : ''} ${esc(o.btnLabel)}
        </button>
        <div class="grid grid-cols-3 gap-2.5 mt-6 max-w-md">
          ${o.mini.map(m => `<div class="bg-white/15 backdrop-blur rounded-2xl px-2 py-3 text-center">
            <div class="dash-counter text-2xl font-700 leading-none" data-target="${Number(m.v) || 0}">0</div>
            <div class="text-[11px] text-white/80 mt-1">${esc(m.l)}</div></div>`).join('')}
        </div>
      </div>
    </section>`;
}

function dashQuick(items) {
  return `<section class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
    ${items.map((it, i) => `
      <button onclick="${it.action}" class="dash-glass card-hover press rounded-3xl p-5 flex items-center gap-4 text-left dash-anim" style="animation-delay:${0.06 + i * 0.04}s">
        <div class="w-14 h-14 rounded-2xl ${DASH_TONES[it.tone]} flex items-center justify-center shrink-0"><i data-lucide="${it.icon}" class="w-7 h-7"></i></div>
        <div class="min-w-0"><div class="font-600 text-ink">${esc(it.title)}</div><div class="text-sm text-muted">${esc(it.sub)}</div></div>
        <i data-lucide="arrow-up-right" class="w-5 h-5 text-muted ml-auto shrink-0"></i>
      </button>`).join('')}
  </section>`;
}

function dashProcess() {
  const steps = [
    { n: 1, icon: 'settings-2', tone: 'blue', t: 'ตั้งค่า', d: 'กำหนดข้อมูลระบบ โฟลเดอร์จัดเก็บ และผู้ใช้งาน' },
    { n: 2, icon: 'clipboard-list', tone: 'sky', t: 'บันทึกข้อมูล', d: 'บันทึกการเยี่ยม สุขภาพ และกิจกรรมการดูแล' },
    { n: 3, icon: 'line-chart', tone: 'emerald', t: 'วิเคราะห์ข้อมูล', d: 'สรุปสถิติ แนวโน้ม และเคสที่ต้องติดตามพิเศษ' }
  ];
  return `<h2 class="text-sm font-600 text-muted px-1 mb-3">ขั้นตอนการทำงาน</h2>
    <section class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      ${steps.map((s, i) => `<div class="dash-glass-soft card-hover rounded-3xl p-5 dash-anim" style="animation-delay:${0.08 + i * 0.04}s">
        <div class="flex items-center justify-between mb-3">
          <div class="w-12 h-12 rounded-2xl ${DASH_TONES[s.tone]} flex items-center justify-center"><i data-lucide="${s.icon}" class="w-6 h-6"></i></div>
          <span class="text-3xl font-700 text-ink/10">${s.n}</span>
        </div>
        <div class="font-600 text-ink">${esc(s.t)}</div>
        <p class="text-sm text-muted mt-1">${esc(s.d)}</p>
      </div>`).join('')}
    </section>`;
}

function dashSectionTitle(t) { return `<h2 class="text-sm font-600 text-muted px-1 mb-3">${esc(t)}</h2>`; }

function dashStatGrid(cards) {
  return `<section class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    ${cards.map((c, i) => `<div class="dash-glass card-hover rounded-3xl p-4 dash-anim" style="animation-delay:${0.1 + i * 0.04}s">
      <div class="w-11 h-11 rounded-2xl ${DASH_TONES[c.tone]} flex items-center justify-center mb-3"><i data-lucide="${c.icon}" class="w-6 h-6"></i></div>
      <div class="flex items-end gap-1">
        <span class="dash-counter text-2xl sm:text-3xl font-700 text-ink leading-none" data-target="${Number(c.value) || 0}">0</span>
        ${c.unit ? `<span class="text-xs text-muted mb-0.5">${esc(c.unit)}</span>` : ''}
      </div>
      <div class="text-sm text-muted mt-1.5">${esc(c.label)}</div>
      ${c.sub ? `<div class="text-xs ${DASH_SUBTONE[c.tone]} font-500 mt-1.5 flex items-center gap-1"><i data-lucide="trending-up" class="w-3.5 h-3.5"></i> ${esc(c.sub)}</div>` : ''}
    </div>`).join('')}
  </section>`;
}

function dashPill(status) {
  const map = { urgent: { l: 'ติดตามด่วน', i: 'alert-triangle' }, watch: { l: 'เฝ้าระวัง', i: 'eye' }, stable: { l: 'ปกติ', i: 'check' } };
  const s = map[status] || map.stable;
  return `<span class="dash-pill ${status || 'stable'}"><i data-lucide="${s.i}" class="w-3.5 h-3.5"></i> ${s.l}</span>`;
}

function dashFollowupSection(cases) {
  const head = `<div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2.5">
        <div class="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center"><i data-lucide="bell-ring" class="w-5 h-5"></i></div>
        <div><h2 class="font-700 text-ink">เคสที่ต้องติดตาม</h2><p class="text-xs text-muted">ผู้ป่วยที่ใกล้ครบกำหนดเยี่ยมหรือควรดูแลเร่งด่วน</p></div>
      </div>
      <button onclick="navigate('patients')" class="hidden sm:inline-flex items-center gap-1.5 text-sm font-500 text-blue-600 press">ดูทั้งหมด <i data-lucide="chevron-right" class="w-4 h-4"></i></button>
    </div>`;

  if (!cases.length) {
    return `<section class="dash-glass rounded-3xl p-5 sm:p-6 dash-anim" style="animation-delay:.16s">${head}
      <div class="text-center text-muted text-sm py-8">ยังไม่มีเคสที่ต้องติดตาม</div></section>`;
  }

  const rows = cases.map(p => `<tr class="border-t border-line hover:bg-subtle transition">
      <td class="py-3 px-4"><div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl grad-bg2g text-white text-sm font-600 flex items-center justify-center shrink-0">${esc((p.name || '?').charAt(0))}</div>
        <span class="font-500 text-ink">${esc(p.name)}</span></div></td>
      <td class="py-3 px-4 text-muted">${esc(p.village)}</td>
      <td class="py-3 px-4 text-muted">${esc(p.caregiver)}</td>
      <td class="py-3 px-4 text-muted">${esc(p.lastVisit)}</td>
      <td class="py-3 px-4">${dashPill(p.status)}</td>
      <td class="py-3 px-4 text-right">
        <button onclick="navigate('history', { patientId: '${esc(p.patientId)}' })" class="press inline-flex items-center gap-1.5 text-sm font-500 text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 px-3 h-9 rounded-xl transition"><i data-lucide="history" class="w-4 h-4"></i> ประวัติ</button>
      </td></tr>`).join('');

  const mobileCards = cases.map(p => `<div class="dash-glass-soft rounded-2xl p-4">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl grad-bg2g text-white font-600 flex items-center justify-center shrink-0">${esc((p.name || '?').charAt(0))}</div>
        <div class="flex-1 min-w-0"><div class="font-600 text-ink truncate">${esc(p.name)}</div><div class="text-xs text-muted">${esc(p.village)}</div></div>
        ${dashPill(p.status)}
      </div>
      <div class="grid grid-cols-2 gap-2 mt-3 text-sm">
        <div><div class="text-xs text-muted">Care Giver</div><div class="text-ink">${esc(p.caregiver)}</div></div>
        <div><div class="text-xs text-muted">เยี่ยมล่าสุด</div><div class="text-ink">${esc(p.lastVisit)}</div></div>
      </div>
      <button onclick="navigate('history', { patientId: '${esc(p.patientId)}' })" class="press w-full mt-3 inline-flex items-center justify-center gap-1.5 text-sm font-500 text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 h-10 rounded-2xl transition"><i data-lucide="history" class="w-4 h-4"></i> ดูประวัติ</button>
    </div>`).join('');

  return `<section class="dash-glass rounded-3xl p-5 sm:p-6 dash-anim" style="animation-delay:.16s">
      ${head}
      <div class="hidden md:block overflow-hidden rounded-2xl border border-line">
        <table class="w-full text-sm">
          <thead><tr class="bg-subtle text-muted text-left">
            <th class="py-3 px-4 font-500">ชื่อผู้ป่วย</th><th class="py-3 px-4 font-500">หมู่บ้าน</th>
            <th class="py-3 px-4 font-500">Care Giver</th><th class="py-3 px-4 font-500">เยี่ยมล่าสุด</th>
            <th class="py-3 px-4 font-500">สถานะ</th><th class="py-3 px-4 font-500 text-right">จัดการ</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="md:hidden space-y-3">${mobileCards}</div>
    </section>`;
}

function recentCasesCard(title, items, showCaregiver) {
  const rows = items.length ? items.map(it => `
    <button onclick="navigate('history', { patientId: '${esc(it.patientId)}' })"
      class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-subtle text-left border border-line">
      <div class="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-600 shrink-0">
        ${esc((it.patientName || '?').charAt(0))}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-500 text-ink truncate">${esc(it.patientName || '-')}</div>
        <div class="text-xs text-muted">ครั้งที่ ${esc(it.visitNo)} · ${formatThaiDate(it.visitDate)}${showCaregiver && it.caregiverName ? ' · ' + esc(it.caregiverName) : ''}</div>
      </div>
      <i data-lucide="chevron-right" class="w-5 h-5 text-muted shrink-0"></i>
    </button>`).join('')
    : `<div class="text-center text-muted text-sm py-8">ยังไม่มีข้อมูล</div>`;

  return `<div class="bg-card rounded-2xl shadow-card p-4">
      <div class="flex items-center gap-2 mb-3">
        <i data-lucide="clock" class="w-5 h-5 text-primary"></i>
        <h3 class="font-600 text-ink">${esc(title)}</h3>
      </div>
      <div class="space-y-2">${rows}</div>
    </div>`;
}

function skeletonGrid(n) {
  let cards = '';
  for (let i = 0; i < n; i++) {
    cards += `<div class="bg-card rounded-2xl shadow-card p-4 animate-pulse">
        <div class="w-12 h-12 rounded-xl bg-subtle mb-3"></div>
        <div class="h-6 w-12 bg-subtle rounded mb-2"></div>
        <div class="h-3 w-20 bg-subtle rounded"></div>
      </div>`;
  }
  return `<div class="grid grid-cols-2 lg:grid-cols-3 gap-3">${cards}</div>`;
}


// ===============================
// MODAL SYSTEM
// ===============================
function ensureModalRoot() {
  let root = $id('modalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    document.body.appendChild(root);
  }
  return root;
}
function showModal(opts) {
  const root = ensureModalRoot();
  root.innerHTML = `
    <div class="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
      <div class="absolute inset-0 bg-slate-900/50" onclick="closeModal()"></div>
      <div class="relative bg-card w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-soft max-h-[92vh] flex flex-col">
        <div class="flex items-center justify-between px-5 h-14 border-b border-line shrink-0">
          <h3 class="font-600 text-ink">${esc(opts.title || '')}</h3>
          <button onclick="closeModal()" class="p-2 -mr-2 text-muted"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
        <div class="overflow-y-auto p-5 flex-1">${opts.body || ''}</div>
        ${opts.footer ? `<div class="px-5 py-3 border-t border-line shrink-0">${opts.footer}</div>` : ''}
      </div>
    </div>`;
  refreshIcons();
  if (opts.onMount) opts.onMount(root);
}
function closeModal() { const r = $id('modalRoot'); if (r) r.innerHTML = ''; }

function modalFooter(submitLabel, submitFn) {
  return `<div class="flex gap-2">
      <button onclick="closeModal()" class="btn flex-1 h-11 rounded-xl bg-subtle text-ink font-500">ยกเลิก</button>
      <button onclick="${submitFn}" class="btn flex-1 h-11 rounded-xl bg-primary text-white font-500">${esc(submitLabel)}</button>
    </div>`;
}


// ===============================
// FRONTEND VALIDATORS / HELPERS
// ===============================
function feValidatePid(pid) {
  pid = String(pid || '').trim();
  if (!/^\d{13}$/.test(pid)) return false;
  let s = 0;
  for (let i = 0; i < 12; i++) s += parseInt(pid[i], 10) * (13 - i);
  return ((11 - (s % 11)) % 10) === parseInt(pid[12], 10);
}
function feValidatePhone(p) {
  p = String(p || '').replace(/[-\s]/g, '');
  return /^0\d{8,9}$/.test(p);
}
function debounce(fn, ms) {
  let t;
  return function () { clearTimeout(t); const a = arguments, c = this; t = setTimeout(() => fn.apply(c, a), ms); };
}
function statusBadge(status) {
  const active = String(status).toLowerCase() === 'active';
  return `<span class="px-2.5 py-1 rounded-full text-[11px] font-500 ${active ? 'bg-success/10 text-success' : 'bg-subtle text-muted'}">${active ? 'ใช้งาน' : 'ระงับ'}</span>`;
}
function emptyState(text) {
  return `<div class="bg-card rounded-2xl shadow-card p-10 text-center text-muted">
      <i data-lucide="inbox" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
      <div>${esc(text)}</div></div>`;
}
function listSkeleton() {
  let s = '';
  for (let i = 0; i < 3; i++) s += `<div class="bg-card rounded-2xl shadow-card p-4 mb-3 animate-pulse h-24"></div>`;
  return s;
}
function listToolbar(o) {
  return `<div class="flex flex-col sm:flex-row gap-2 mb-4">
     <div class="relative flex-1">
       <i data-lucide="search" class="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2"></i>
       <input id="${o.searchId}" type="text" placeholder="${esc(o.placeholder)}"
         class="w-full h-11 pl-10 pr-3 rounded-xl border border-line focus:border-primary outline-none">
     </div>
     ${o.extra || ''}
     <button onclick="${o.addFn}" class="btn h-11 px-4 rounded-xl bg-primary text-white font-500 flex items-center justify-center gap-2 shrink-0">
       <i data-lucide="plus" class="w-5 h-5"></i> ${esc(o.addLabel)}
     </button>
   </div>`;
}
function iconBtn(icon, title, onclick, color) {
  return `<button title="${esc(title)}" onclick="${onclick}"
      class="btn w-9 h-9 rounded-lg flex items-center justify-center" style="background:${color}1A;color:${color}">
      <i data-lucide="${icon}" class="w-[18px] h-[18px]"></i></button>`;
}

// อัปโหลดรูปภาพ 1 ไฟล์ → คืน URL
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
async function uploadOneImage(file, folderKey) {
  const b64 = await fileToBase64(file);
  const res = await api('uploadImage', { image: b64, filename: file.name, folderKey: folderKey || 'DRIVE_FOLDER_PROFILE' }, { loadingText: 'กำลังอัปโหลดรูป...' });
  if (res.success) return res.data.url;
  throw new Error(res.message || 'อัปโหลดรูปไม่สำเร็จ');
}


// ===============================
// VIEW: จัดการ CARE GIVER (Admin)
// ===============================
let _caregivers = [];

async function viewCaregivers(container) {
  container.innerHTML = listToolbar({
    searchId: 'cgSearch', placeholder: 'ค้นหาชื่อ / รหัส / เลขบัตร / เบอร์โทร',
    addLabel: 'เพิ่ม', addFn: 'cgAdd()'
  }) + `<div id="cgList"></div>`;
  refreshIcons();
  $id('cgSearch').addEventListener('input', debounce(renderCaregiverList, 200));
  await loadCaregivers();
}
async function loadCaregivers() {
  $id('cgList').innerHTML = listSkeleton();
  const res = await api('getCareGivers', {}, { loading: false });
  if (!res.success) { $id('cgList').innerHTML = emptyState('โหลดข้อมูลไม่สำเร็จ'); refreshIcons(); return; }
  _caregivers = res.data || [];
  renderCaregiverList();
}
function renderCaregiverList() {
  const q = ($id('cgSearch') ? $id('cgSearch').value.trim().toLowerCase() : '');
  let rows = _caregivers;
  if (q) rows = rows.filter(c => [c.caregiverCode, c.fullName, c.pid, c.phone, c.username].some(v => String(v).toLowerCase().includes(q)));

  if (!rows.length) { $id('cgList').innerHTML = emptyState('ยังไม่มีข้อมูล Care Giver'); refreshIcons(); return; }

  // การ์ด (มือถือ)
  const cards = rows.map(c => `
    <div class="bg-card rounded-2xl shadow-card p-4">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-600 shrink-0">${esc((c.fullName || '?').charAt(0))}</div>
          <div class="min-w-0">
            <div class="font-500 text-ink truncate">${esc(c.fullName)}</div>
            <div class="text-xs text-primary font-500">${esc(c.caregiverCode)}</div>
          </div>
        </div>
        ${statusBadge(c.status)}
      </div>
      <div class="grid grid-cols-2 gap-y-1 gap-x-3 mt-3 text-sm">
        <div class="text-muted">บัตร ปชช.</div><div class="text-ink text-right">${esc(c.pid)}</div>
        <div class="text-muted">เบอร์โทร</div><div class="text-ink text-right">${esc(c.phone)}</div>
        <div class="text-muted">บ้าน/หมู่</div><div class="text-ink text-right">${esc(c.houseNo || '-')} / ${esc(c.moo || '-')}</div>
        <div class="text-muted">ชื่อผู้ใช้</div><div class="text-ink text-right">${esc(c.username)}</div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="cgEdit('${esc(c.caregiverCode)}')" class="btn flex-1 h-10 rounded-xl bg-primary/10 text-primary font-500 flex items-center justify-center gap-1.5"><i data-lucide="pencil" class="w-4 h-4"></i> แก้ไข</button>
        <button onclick="cgDelete('${esc(c.caregiverCode)}')" class="btn flex-1 h-10 rounded-xl bg-danger/10 text-danger font-500 flex items-center justify-center gap-1.5"><i data-lucide="trash-2" class="w-4 h-4"></i> ลบ</button>
      </div>
    </div>`).join('');

  // ตาราง (เดสก์ท็อป)
  const trs = rows.map(c => `
    <tr class="border-t border-line hover:bg-subtle">
      <td class="py-3 px-3 font-500 text-primary">${esc(c.caregiverCode)}</td>
      <td class="py-3 px-3">${esc(c.fullName)}</td>
      <td class="py-3 px-3">${esc(c.phone)}</td>
      <td class="py-3 px-3">${esc(c.houseNo || '-')} / ${esc(c.moo || '-')}</td>
      <td class="py-3 px-3">${statusBadge(c.status)}</td>
      <td class="py-3 px-3"><div class="flex gap-1.5 justify-end">
        ${iconBtn('pencil', 'แก้ไข', `cgEdit('${esc(c.caregiverCode)}')`, '#2563EB')}
        ${iconBtn('trash-2', 'ลบ', `cgDelete('${esc(c.caregiverCode)}')`, '#EF4444')}
      </div></td>
    </tr>`).join('');

  $id('cgList').innerHTML = `
    <div class="md:hidden space-y-3">${cards}</div>
    <div class="hidden md:block bg-card rounded-2xl shadow-card overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="bg-subtle text-muted text-left">
          <th class="py-3 px-3 font-500">รหัส</th><th class="py-3 px-3 font-500">ชื่อ-สกุล</th>
          <th class="py-3 px-3 font-500">เบอร์โทร</th><th class="py-3 px-3 font-500">บ้าน/หมู่</th>
          <th class="py-3 px-3 font-500">สถานะ</th><th class="py-3 px-3 font-500 text-right">จัดการ</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>`;
  refreshIcons();
}

function cgFormHtml(c) {
  const isEdit = !!c;
  return `
    <div class="space-y-3.5">
      ${inputField('cgFullName', 'ชื่อ-สกุล *', 'text', c ? c.fullName : '')}
      ${inputField('cgPid', 'เลขบัตรประชาชน (13 หลัก) *', 'text', c ? c.pid : '', 'inputmode="numeric" maxlength="13"')}
      ${inputField('cgPhone', 'เบอร์โทร *', 'tel', c ? c.phone : '', 'inputmode="tel"')}
      <div class="grid grid-cols-2 gap-3">
        ${inputField('cgHouse', 'บ้านเลขที่', 'text', c ? c.houseNo : '')}
        ${inputField('cgMoo', 'หมู่', 'text', c ? c.moo : '')}
      </div>
      ${inputField('cgUsername', 'ชื่อผู้ใช้ (สำหรับเข้าระบบ) *', 'text', c ? c.username : '', isEdit ? 'disabled' : '')}
      ${inputField('cgPassword', isEdit ? 'รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)' : 'รหัสผ่าน (อย่างน้อย 6 ตัว) *', 'password', '')}
      ${isEdit ? selectField('cgStatus', 'สถานะ', [['active', 'ใช้งาน'], ['inactive', 'ระงับ']], c.status) : ''}
    </div>`;
}
function cgAdd() {
  showModal({ title: 'เพิ่ม Care Giver', body: cgFormHtml(null), footer: modalFooter('บันทึก', "cgSubmit('')") });
}
function cgEdit(code) {
  const c = _caregivers.find(x => x.caregiverCode === code);
  if (!c) return;
  showModal({ title: 'แก้ไข Care Giver', body: cgFormHtml(c), footer: modalFooter('บันทึก', `cgSubmit('${esc(code)}')`) });
}
async function cgSubmit(editCode) {
  const val = id => ($id(id) ? $id(id).value.trim() : '');
  const fullName = val('cgFullName'), pid = val('cgPid'), phone = val('cgPhone');
  const houseNo = val('cgHouse'), moo = val('cgMoo'), username = val('cgUsername');
  const password = $id('cgPassword').value;

  if (!fullName) return alertError('กรุณากรอกชื่อ-สกุล');
  if (!feValidatePid(pid)) return alertError('เลขบัตรประชาชนไม่ถูกต้อง (ต้อง 13 หลักตามรูปแบบบัตรประชาชนไทย)');
  if (!feValidatePhone(phone)) return alertError('รูปแบบเบอร์โทรไม่ถูกต้อง (เช่น 0812345678)');

  let res;
  if (editCode) {
    if (password && password.length < 6) return alertError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    const data = { caregiverCode: editCode, fullName, pid, phone, houseNo, moo, status: val('cgStatus') };
    if (password) data.password = password;
    res = await api('updateCareGiver', data, { loadingText: 'กำลังบันทึก...' });
  } else {
    if (!username) return alertError('กรุณากรอกชื่อผู้ใช้');
    if (password.length < 6) return alertError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    res = await api('createCareGiver', { fullName, pid, phone, houseNo, moo, username, password }, { loadingText: 'กำลังบันทึก...' });
  }
  if (res.success) { closeModal(); toast('บันทึกสำเร็จ'); loadCaregivers(); }
}
async function cgDelete(code) {
  const c = _caregivers.find(x => x.caregiverCode === code);
  const ok = await confirmDialog({ title: 'ลบ Care Giver?', text: `ต้องการลบ "${c ? c.fullName : code}" และบัญชีผู้ใช้ที่ผูกกัน?`, danger: true, confirmText: 'ลบ' });
  if (!ok) return;
  const res = await api('deleteCareGiver', { caregiverCode: code }, { loadingText: 'กำลังลบ...' });
  if (res.success) { toast('ลบสำเร็จ'); loadCaregivers(); }
}


// ===============================
// VIEW: จัดการ PATIENT (Admin)
// ===============================
let _patients = [];
let _ptPhoto = { file: null };

async function viewPatients(container) {
  container.innerHTML = listToolbar({
    searchId: 'ptSearch', placeholder: 'ค้นหาชื่อ / เลขบัตร / บ้าน',
    addLabel: 'เพิ่ม', addFn: 'ptAdd()',
    extra: `<select id="ptMoo" class="h-11 px-3 rounded-xl border border-line bg-card text-ink"><option value="">ทุกหมู่</option></select>`
  }) + `<div id="ptList"></div>`;
  refreshIcons();
  $id('ptSearch').addEventListener('input', debounce(renderPatientList, 200));
  $id('ptMoo').addEventListener('change', renderPatientList);
  await loadPatients();
}
async function loadPatients() {
  $id('ptList').innerHTML = listSkeleton();
  const res = await api('getPatients', {}, { loading: false });
  if (!res.success) { $id('ptList').innerHTML = emptyState('โหลดข้อมูลไม่สำเร็จ'); refreshIcons(); return; }
  _patients = res.data || [];
  // เติมตัวเลือกหมู่
  const moos = [...new Set(_patients.map(p => String(p.moo || '')).filter(Boolean))].sort();
  const sel = $id('ptMoo');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">ทุกหมู่</option>` + moos.map(m => `<option value="${esc(m)}">หมู่ ${esc(m)}</option>`).join('');
    sel.value = cur;
  }
  renderPatientList();
}
function renderPatientList() {
  const q = ($id('ptSearch') ? $id('ptSearch').value.trim().toLowerCase() : '');
  const moo = ($id('ptMoo') ? $id('ptMoo').value : '');
  let rows = _patients;
  if (q) rows = rows.filter(p => [p.fullName, p.pid, p.houseNo, p.patientId].some(v => String(v).toLowerCase().includes(q)));
  if (moo) rows = rows.filter(p => String(p.moo) === moo);

  if (!rows.length) { $id('ptList').innerHTML = emptyState('ยังไม่มีข้อมูลผู้มีภาวะพึ่งพิง'); refreshIcons(); return; }

  const actions = id => `<div class="flex flex-wrap gap-1.5">
      ${iconBtn('eye', 'ดูข้อมูล', `ptView('${esc(id)}')`, '#64748B')}
      ${iconBtn('pencil', 'แก้ไข', `ptEdit('${esc(id)}')`, '#2563EB')}
      ${iconBtn('user-plus', 'มอบหมาย', `ptAssign('${esc(id)}')`, '#22C55E')}
      ${iconBtn('file-plus-2', 'บันทึกการเยี่ยม', `navigate('visitForm', { patientId: '${esc(id)}' })`, '#60A5FA')}
      ${iconBtn('history', 'ดูประวัติ', `navigate('history', { patientId: '${esc(id)}' })`, '#F59E0B')}
      ${iconBtn('trash-2', 'ลบ', `ptDelete('${esc(id)}')`, '#EF4444')}
    </div>`;

  const cards = rows.map(p => `
    <div class="bg-card rounded-2xl shadow-card p-4">
      <div class="flex items-start gap-3">
        <img src="${esc(p.imageUrl)}" alt="" class="w-14 h-14 rounded-xl object-cover bg-subtle shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <div class="font-500 text-ink truncate">${esc(p.fullName)}</div>
            ${statusBadge(p.status)}
          </div>
          <div class="text-xs text-muted mt-0.5">${esc(p.patientId)} · ${esc(p.gender || '-')} · อายุ ${p.age !== '' ? esc(p.age) + ' ปี' : '-'}</div>
          <div class="text-xs text-muted mt-0.5">บ้าน ${esc(p.houseNo || '-')} หมู่ ${esc(p.moo || '-')}</div>
        </div>
      </div>
      <div class="mt-3">${actions(p.patientId)}</div>
    </div>`).join('');

  const trs = rows.map(p => `
    <tr class="border-t border-line hover:bg-subtle">
      <td class="py-2.5 px-3">${esc(p.no || '-')}</td>
      <td class="py-2.5 px-3"><div class="flex items-center gap-2">
        <img src="${esc(p.imageUrl)}" class="w-9 h-9 rounded-lg object-cover bg-subtle" /><span class="font-500">${esc(p.fullName)}</span></div></td>
      <td class="py-2.5 px-3">${esc(p.gender || '-')} / ${p.age !== '' ? esc(p.age) : '-'} ปี</td>
      <td class="py-2.5 px-3">${esc(p.houseNo || '-')} / ${esc(p.moo || '-')}</td>
      <td class="py-2.5 px-3">${statusBadge(p.status)}</td>
      <td class="py-2.5 px-3">${actions(p.patientId)}</td>
    </tr>`).join('');

  $id('ptList').innerHTML = `
    <div class="md:hidden space-y-3">${cards}</div>
    <div class="hidden md:block bg-card rounded-2xl shadow-card overflow-x-auto">
      <table class="w-full text-sm min-w-[640px]">
        <thead><tr class="bg-subtle text-muted text-left">
          <th class="py-3 px-3 font-500">ลำดับ</th><th class="py-3 px-3 font-500">ชื่อ-สกุล</th>
          <th class="py-3 px-3 font-500">เพศ/อายุ</th><th class="py-3 px-3 font-500">บ้าน/หมู่</th>
          <th class="py-3 px-3 font-500">สถานะ</th><th class="py-3 px-3 font-500">จัดการ</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>`;
  refreshIcons();
}

function ptFormHtml(p) {
  const img = p ? p.imageUrl : '';
  return `
    <div class="space-y-3.5">
      <div>
        <label class="block text-sm text-muted mb-1.5">รูปภาพ (ถ้าไม่มีระบบจะใช้ Avatar)</label>
        <div class="flex items-center gap-3">
          <img id="ptPhotoPreview" src="${esc(img)}" class="w-16 h-16 rounded-xl object-cover bg-subtle ${img ? '' : 'hidden'}" />
          <label class="btn cursor-pointer h-11 px-4 rounded-xl bg-subtle text-ink font-500 flex items-center gap-2">
            <i data-lucide="image-plus" class="w-5 h-5"></i> เลือกรูป
            <input type="file" accept="image/*" class="hidden" onchange="ptPhotoChange(event)">
          </label>
        </div>
      </div>
      ${inputField('ptFullName', 'ชื่อ-สกุล *', 'text', p ? p.fullName : '')}
      ${inputField('ptPid', 'เลขบัตรประชาชน (13 หลัก) *', 'text', p ? p.pid : '', 'inputmode="numeric" maxlength="13"')}
      <div class="grid grid-cols-2 gap-3">
        ${inputField('ptBirth', 'วันเกิด', 'text', p ? toISODate(p.birthDate) : '')}
        ${selectField('ptGender', 'เพศ', [['', '-'], ['ชาย', 'ชาย'], ['หญิง', 'หญิง']], p ? p.gender : '')}
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${inputField('ptHouse', 'บ้านเลขที่', 'text', p ? p.houseNo : '')}
        ${inputField('ptMooF', 'หมู่', 'text', p ? p.moo : '')}
      </div>
      ${inputField('ptCgName', 'ชื่อผู้ดูแล (ในครอบครัว)', 'text', p ? p.caregiverName : '')}
      ${inputField('ptCgPhone', 'เบอร์โทรผู้ดูแล', 'tel', p ? p.caregiverPhone : '', 'inputmode="tel"')}
      ${p ? selectField('ptStatus', 'สถานะ', [['active', 'ใช้งาน'], ['inactive', 'ระงับ']], p.status) : ''}
    </div>`;
}
function ptPhotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  _ptPhoto.file = file;
  const prev = $id('ptPhotoPreview');
  prev.src = URL.createObjectURL(file);
  prev.classList.remove('hidden');
}
function ptAdd() {
  _ptPhoto = { file: null };
  showModal({ title: 'เพิ่มผู้มีภาวะพึ่งพิง', body: ptFormHtml(null), footer: modalFooter('บันทึก', "ptSubmit('')") });
  fpInit('ptBirth');
}
function ptEdit(id) {
  const p = _patients.find(x => x.patientId === id);
  if (!p) return;
  _ptPhoto = { file: null };
  showModal({ title: 'แก้ไขข้อมูลผู้พึ่งพิง', body: ptFormHtml(p), footer: modalFooter('บันทึก', `ptSubmit('${esc(id)}')`) });
  fpInit('ptBirth');
}
async function ptSubmit(editId) {
  const val = id => ($id(id) ? $id(id).value.trim() : '');
  const fullName = val('ptFullName'), pid = val('ptPid');
  if (!fullName) return alertError('กรุณากรอกชื่อ-สกุล');
  if (!feValidatePid(pid)) return alertError('เลขบัตรประชาชนไม่ถูกต้อง (ต้อง 13 หลักตามรูปแบบบัตรประชาชนไทย)');
  const phone = val('ptCgPhone');
  if (phone && !feValidatePhone(phone)) return alertError('รูปแบบเบอร์โทรผู้ดูแลไม่ถูกต้อง');

  const data = {
    fullName, pid,
    birthDate: val('ptBirth'), gender: val('ptGender'),
    houseNo: val('ptHouse'), moo: val('ptMooF'),
    caregiverName: val('ptCgName'), caregiverPhone: phone
  };

  // อัปโหลดรูปถ้ามีการเลือกใหม่
  if (_ptPhoto.file) {
    try { data.imageUrl = await uploadOneImage(_ptPhoto.file); }
    catch (e) { return alertError(e.message); }
  }

  let res;
  if (editId) {
    data.patientId = editId;
    data.status = val('ptStatus');
    res = await api('updatePatient', data, { loadingText: 'กำลังบันทึก...' });
  } else {
    res = await api('createPatient', data, { loadingText: 'กำลังบันทึก...' });
  }
  if (res.success) { closeModal(); toast('บันทึกสำเร็จ'); loadPatients(); }
}
async function ptDelete(id) {
  const p = _patients.find(x => x.patientId === id);
  const ok = await confirmDialog({ title: 'ลบผู้ป่วย?', text: `ต้องการลบ "${p ? p.fullName : id}" ?`, danger: true, confirmText: 'ลบ' });
  if (!ok) return;
  const res = await api('deletePatient', { patientId: id }, { loadingText: 'กำลังลบ...' });
  if (res.success) { toast('ลบสำเร็จ'); loadPatients(); }
}
function ptView(id) {
  const p = _patients.find(x => x.patientId === id);
  if (!p) return;
  const row = (label, val) => `<div class="flex justify-between gap-3 py-2 border-b border-line"><span class="text-muted text-sm">${esc(label)}</span><span class="text-ink text-sm font-500 text-right">${esc(val || '-')}</span></div>`;
  showModal({
    title: 'ข้อมูลผู้มีภาวะพึ่งพิง',
    body: `
      <div class="flex flex-col items-center mb-4">
        <img src="${esc(p.imageUrl)}" class="w-24 h-24 rounded-2xl object-cover bg-subtle mb-2" />
        <div class="font-600 text-ink">${esc(p.fullName)}</div>
        <div class="text-xs text-primary">${esc(p.patientId)}</div>
      </div>
      ${row('เลขบัตรประชาชน', p.pid)}
      ${row('วันเกิด', formatThaiDate(p.birthDate))}
      ${row('อายุ', p.age !== '' ? p.age + ' ปี' : '-')}
      ${row('เพศ', p.gender)}
      ${row('บ้านเลขที่ / หมู่', (p.houseNo || '-') + ' / ' + (p.moo || '-'))}
      ${row('ผู้ดูแล (ครอบครัว)', p.caregiverName)}
      ${row('เบอร์โทรผู้ดูแล', p.caregiverPhone)}
      ${row('สถานะ', String(p.status).toLowerCase() === 'active' ? 'ใช้งาน' : 'ระงับ')}
      <div class="grid grid-cols-2 gap-2 mt-4">
        <button onclick="navigate('history', { patientId: '${esc(id)}' }); closeModal();" class="btn h-11 rounded-xl bg-primary/10 text-primary font-500 flex items-center justify-center gap-2"><i data-lucide="history" class="w-5 h-5"></i> ดูประวัติ</button>
        <button onclick="ptAssign('${esc(id)}')" class="btn h-11 rounded-xl bg-success/10 text-success font-500 flex items-center justify-center gap-2"><i data-lucide="user-plus" class="w-5 h-5"></i> มอบหมาย</button>
      </div>`
  });
}
async function ptAssign(id) {
  const p = _patients.find(x => x.patientId === id);
  if (!p) return;
  const res = await api('getCareGivers', {}, { loadingText: 'กำลังโหลด Care Giver...' });
  if (!res.success) return;
  const cgs = (res.data || []).filter(c => String(c.status).toLowerCase() === 'active');
  if (!cgs.length) return alertError('ยังไม่มี Care Giver ในระบบ กรุณาเพิ่มก่อน');
  const opts = cgs.map(c => `<option value="${esc(c.caregiverCode)}">${esc(c.caregiverCode)} · ${esc(c.fullName)}</option>`).join('');
  showModal({
    title: 'มอบหมายการดูแล',
    body: `<div class="mb-3 p-3 bg-subtle rounded-xl text-sm"><span class="text-muted">ผู้ป่วย: </span><span class="font-500">${esc(p.fullName)}</span></div>
      <label class="block text-sm text-muted mb-1.5">เลือก Care Giver</label>
      <select id="assignCg" class="w-full h-12 px-3 rounded-xl border border-line bg-card">${opts}</select>
      <p class="text-xs text-muted mt-2">หมายเหตุ: การมอบหมายใหม่จะแทนที่ผู้ดูแลคนเดิมของผู้ป่วยรายนี้</p>`,
    footer: modalFooter('มอบหมาย', `ptAssignConfirm('${esc(id)}')`)
  });
}
async function ptAssignConfirm(id) {
  const code = $id('assignCg').value;
  const res = await api('assignPatient', { patientId: id, caregiverCode: code }, { loadingText: 'กำลังมอบหมาย...' });
  if (res.success) { closeModal(); toast('มอบหมายสำเร็จ'); }
}


// ===============================
// FORM FIELD HELPERS
// ===============================
function inputField(id, label, type, value, extraAttr) {
  return `<div>
      <label class="block text-sm text-muted mb-1.5">${esc(label)}</label>
      <input id="${id}" type="${type || 'text'}" value="${esc(value || '')}" ${extraAttr || ''}
        class="w-full h-12 px-3.5 rounded-xl border border-line focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none disabled:bg-subtle disabled:text-muted">
    </div>`;
}
function selectField(id, label, options, selected) {
  const opts = options.map(o => {
    const v = Array.isArray(o) ? o[0] : o;
    const t = Array.isArray(o) ? o[1] : o;
    return `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(t)}</option>`;
  }).join('');
  return `<div>
      <label class="block text-sm text-muted mb-1.5">${esc(label)}</label>
      <select id="${id}" class="w-full h-12 px-3 rounded-xl border border-line bg-card focus:border-primary outline-none">${opts}</select>
    </div>`;
}
/** แปลงค่าวันที่ให้เป็น yyyy-MM-dd สำหรับ input[type=date] */
function toISODate(value) {
  const d = parseDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


// ===============================
// VIEW: มอบหมายการดูแล (Admin)
// ===============================
let _assignPatients = [];
let _assignMap = {};

async function viewAssign(container) {
  container.innerHTML = `
    <div class="flex flex-col sm:flex-row gap-2 mb-4">
      <div class="relative flex-1">
        <i data-lucide="search" class="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2"></i>
        <input id="asSearch" type="text" placeholder="ค้นหาชื่อ / เลขบัตร" class="w-full h-11 pl-10 pr-3 rounded-xl border border-line focus:border-primary outline-none">
      </div>
      <select id="asFilter" class="h-11 px-3 rounded-xl border border-line bg-card">
        <option value="">ทั้งหมด</option>
        <option value="assigned">มอบหมายแล้ว</option>
        <option value="unassigned">ยังไม่มอบหมาย</option>
      </select>
    </div>
    <div id="asList"></div>`;
  refreshIcons();
  $id('asSearch').addEventListener('input', debounce(renderAssignList, 200));
  $id('asFilter').addEventListener('change', renderAssignList);
  await loadAssignments();
}
async function loadAssignments() {
  $id('asList').innerHTML = listSkeleton();
  const [pRes, aRes] = await Promise.all([
    api('getPatients', {}, { loading: false }),
    api('getAssignedPatients', {}, { loading: false })
  ]);
  _assignPatients = pRes.success ? (pRes.data || []) : [];
  _patients = _assignPatients; // ให้ ptAssign ใช้ cache ร่วม
  _assignMap = {};
  (aRes.success ? aRes.data : []).forEach(a => {
    _assignMap[a.patientId] = { caregiverCode: a.caregiverCode, caregiverName: a.caregiverName };
  });
  renderAssignList();
}
function renderAssignList() {
  const q = ($id('asSearch') ? $id('asSearch').value.trim().toLowerCase() : '');
  const f = ($id('asFilter') ? $id('asFilter').value : '');
  let rows = _assignPatients;
  if (q) rows = rows.filter(p => [p.fullName, p.pid, p.patientId].some(v => String(v).toLowerCase().includes(q)));
  if (f === 'assigned') rows = rows.filter(p => _assignMap[p.patientId]);
  if (f === 'unassigned') rows = rows.filter(p => !_assignMap[p.patientId]);

  if (!rows.length) { $id('asList').innerHTML = emptyState('ไม่พบข้อมูล'); refreshIcons(); return; }

  $id('asList').innerHTML = `<div class="space-y-3">` + rows.map(p => {
    const a = _assignMap[p.patientId];
    return `<div class="bg-card rounded-2xl shadow-card p-4 flex items-center gap-3">
        <img src="${esc(p.imageUrl)}" class="w-12 h-12 rounded-xl object-cover bg-subtle shrink-0">
        <div class="flex-1 min-w-0">
          <div class="font-500 text-ink truncate">${esc(p.fullName)}</div>
          <div class="text-xs mt-0.5 ${a ? 'text-success' : 'text-warning'}">
            ${a ? ('ผู้ดูแล: ' + esc(a.caregiverName) + ' · ' + esc(a.caregiverCode)) : 'ยังไม่มอบหมาย'}</div>
        </div>
        <button onclick="ptAssign('${esc(p.patientId)}')"
          class="btn h-10 px-3 rounded-xl text-sm font-500 flex items-center gap-1.5 shrink-0 ${a ? 'bg-subtle text-ink' : 'bg-primary text-white'}">
          <i data-lucide="${a ? 'repeat' : 'user-plus'}" class="w-4 h-4"></i> ${a ? 'เปลี่ยน' : 'มอบหมาย'}
        </button>
      </div>`;
  }).join('') + `</div>`;
  refreshIcons();
}


// ===============================
// VISIT FORM — ค่าคงที่
// ===============================
const RELATIONSHIPS = ['พ่อ', 'แม่', 'บุตร', 'พี่', 'น้อง', 'หลาน', 'ญาติ', 'อื่น ๆ'];

const DEP9Q = [
  'เบื่อ ไม่สนใจอยากทำอะไร',
  'ไม่สบายใจ ซึมเศร้า ท้อแท้',
  'หลับยาก หรือหลับ ๆ ตื่น ๆ หรือหลับมากไป',
  'เหนื่อยง่าย หรือไม่ค่อยมีแรง',
  'เบื่ออาหาร หรือกินมากเกินไป',
  'รู้สึกไม่ดีกับตัวเอง คิดว่าตัวเองล้มเหลว หรือทำให้ครอบครัวผิดหวัง',
  'สมาธิไม่ดี เช่น เวลาดูโทรทัศน์ ฟังวิทยุ หรือทำงานที่ต้องใช้ความตั้งใจ',
  'พูดช้า ทำอะไรช้าลงจนคนอื่นสังเกตเห็น หรือกระสับกระส่ายอยู่ไม่นิ่งเหมือนที่เคย',
  'คิดทำร้ายตนเอง หรือคิดว่าถ้าตายไปคงจะดี'
];
const DEP9Q_OPTS = [
  { value: '0', label: 'ไม่มีเลย' }, { value: '1', label: 'บางวัน' },
  { value: '2', label: 'บ่อย' }, { value: '3', label: 'ทุกวัน' }
];
const SUI8Q = [
  { t: 'คิดอยากตาย หรือคิดว่าตายไปจะดีกว่า', w: 1 },
  { t: 'อยากทำร้ายตัวเอง หรือทำให้ตัวเองบาดเจ็บ', w: 2 },
  { t: 'ในช่วง 1 เดือนที่ผ่านมา (รวมวันนี้) คิดเกี่ยวกับการฆ่าตัวตาย', w: 6 },
  { t: 'มีแผนการที่จะฆ่าตัวตาย', w: 8 },
  { t: 'ได้เตรียมการที่จะทำร้ายตนเองหรือฆ่าตัวตาย โดยตั้งใจว่าจะให้ตายจริง ๆ', w: 9 },
  { t: 'ได้ทำให้ตนเองบาดเจ็บ แต่ไม่ตั้งใจให้เสียชีวิต', w: 4 },
  { t: 'ได้พยายามฆ่าตัวตาย โดยคาดหวัง/ตั้งใจที่จะให้ตาย', w: 10 },
  { t: 'ตลอดชีวิตที่ผ่านมา เคยพยายามฆ่าตัวตาย', w: 4 }
];
const Q8_WEIGHTS = { 1: 1, 2: 2, 3: 6, 4: 8, 5: 9, 6: 4, 7: 10, 8: 4 };

const DAILY_ACTS = [
  'การเปลี่ยนผ้าอ้อม/แผ่นรองซับ',
  'การพลิกตะแคงตัว',
  'การจัดท่านอนป้องกันแผลกดทับ/ป้องกันเท้าตก',
  'การเคลื่อนย้ายผู้สูงอายุบนเตียง/ที่นอน',
  'การช่วยเคลื่อนย้ายจากจุดหนึ่งไปยังอีกจุดหนึ่ง'
];
const HEALTH_ACTS = [
  'การประเมินภาวะซึมเศร้า', 'การประเมินสัญญาณชีพ', 'การวัดความดันโลหิต',
  'การวัดอุณหภูมิ', 'การประเมินการหายใจ', 'การประเมินชีพจร', 'การทำแผล',
  'การดูแลสายสวนต่าง ๆ ให้สะอาดและอยู่ในตำแหน่งที่เหมาะสม',
  'การนวดผ่อนคลายกล้ามเนื้อและกระตุ้นระบบไหลเวียน',
  'การบริหารข้อและกล้ามเนื้อ', 'การฝึกทรงตัว/การฝึกเดิน', 'สมาธิบำบัด', 'การฝึกหายใจ'
];
const OTHER_ACTS = [
  'ดูแลที่อยู่อาศัยให้สะอาด ปลอดภัย อากาศถ่ายเทสะดวก',
  'ให้คำปรึกษาด้านสุขภาพแก่ผู้สูงอายุ',
  'ให้คำปรึกษาด้านสุขภาพแก่ครอบครัว/ผู้ดูแล',
  'อ่านหนังสือ/บทสวดมนต์ หรือเอกสารที่เป็นประโยชน์ให้ฟัง',
  'ช่วยพาไปพบแพทย์/บุคลากรสาธารณสุขตามนัดหรือตามจำเป็น',
  'บริการหรือจัดพาหนะรับส่งผู้สูงอายุ',
  'ช่วยบุคลากรสาธารณสุขในการทำหัตถการต่าง ๆ',
  'ประสานการเบิกจ่ายวัสดุอุปกรณ์การแพทย์จาก รพ./รพ.สต.',
  'ประสานบุคลากรสาธารณสุขเพื่อช่วยเหลือกรณีฉุกเฉินเร่งด่วน'
];

const MIN_SERVICE_IMAGES = 3; // จำนวนรูปกิจกรรมขั้นต่ำ (ปรับได้)


// ===============================
// VISIT FORM — STATE
// ===============================
let _visitPatientId = null;
let _visitOlderFile = null;
let _visitServiceFiles = [];
let _leafletMap = null, _leafletMarker = null;
let _alerted8Q = false;
let _visitStep = 1;

function resetVisitState() {
  _visitPatientId = null; _visitOlderFile = null; _visitServiceFiles = [];
  _leafletMap = null; _leafletMarker = null; _alerted8Q = false;
  _visitStep = 1;
}


// ===============================
// VISIT FORM — VIEW
// ===============================
async function viewVisitForm(container, params) {
  resetVisitState();
  if (params && params.patientId) {
    return loadVisitForm(container, params.patientId);
  }
  // ยังไม่เลือกผู้ป่วย → แสดงรายการให้เลือก
  container.innerHTML = `<div id="vfPicker"></div>`;
  const listRes = await api(isAdmin() ? 'getPatients' : 'getAssignedPatients', {}, { loadingText: 'กำลังโหลด...' });
  const list = listRes.success ? (listRes.data || []) : [];
  if (!list.length) {
    $id('vfPicker').innerHTML = emptyState(isAdmin() ? 'ยังไม่มีผู้ป่วยในระบบ' : 'คุณยังไม่มีเคสที่ได้รับมอบหมาย');
    refreshIcons(); return;
  }
  $id('vfPicker').innerHTML = `
    <div class="bg-card rounded-2xl shadow-card p-4 mb-3">
      <div class="font-500 text-ink mb-2 flex items-center gap-2"><i data-lucide="hand-pointer" class="w-5 h-5 text-primary"></i> เลือกผู้ป่วยที่จะบันทึกการเยี่ยม</div>
    </div>
    <div class="space-y-2">${list.map(p => `
      <button onclick="navigate('visitForm', { patientId: '${esc(p.patientId)}' })"
        class="w-full bg-card rounded-2xl shadow-card p-3 flex items-center gap-3 text-left hover:bg-subtle">
        <img src="${esc(p.imageUrl)}" class="w-11 h-11 rounded-xl object-cover bg-subtle shrink-0">
        <div class="flex-1 min-w-0"><div class="font-500 text-ink truncate">${esc(p.patientName || p.fullName)}</div>
          <div class="text-xs text-muted">${esc(p.patientId)} · บ้าน ${esc(p.houseNo || '-')} หมู่ ${esc(p.moo || '-')}</div></div>
        <i data-lucide="chevron-right" class="w-5 h-5 text-muted shrink-0"></i>
      </button>`).join('')}</div>`;
  refreshIcons();
}

async function loadVisitForm(container, patientId) {
  const res = await api('getVisitReportByPatient', { patientId }, { loadingText: 'กำลังเตรียมแบบฟอร์ม...' });
  if (!res.success) { container.innerHTML = emptyState(res.message || 'โหลดข้อมูลไม่สำเร็จ'); refreshIcons(); return; }
  const p = res.data.patient;
  const nextNo = (res.data.totalVisits || 0) + 1;
  _visitPatientId = patientId;
  const today = todayISO();
  const visitor = getUser().fullName || getUser().username;

  // ----- เนื้อหาแต่ละขั้น (คง id/handler เดิมทั้งหมด) -----
  const S1 = `
    <div class="grid grid-cols-2 gap-3">
      <div><label class="block text-sm text-muted mb-1.5">ครั้งที่เยี่ยม</label>
        <input value="${nextNo}" disabled class="w-full h-12 px-3.5 rounded-xl border border-line bg-subtle text-ink font-500"></div>
      <div><label class="block text-sm text-muted mb-1.5">วันที่เยี่ยม</label>
        <input id="vDate" type="text" value="${today}" class="w-full h-12 px-3 rounded-xl border border-line outline-none focus:border-primary"></div>
    </div>
    <div class="text-xs text-muted mt-1">วันที่ (พ.ศ.): <span id="vDateTH" class="font-500 text-ink">${formatThaiDate(today)}</span></div>
    <div class="grid grid-cols-2 gap-3 mt-3">
      ${inputField('vStart', 'เวลาเริ่ม *', 'time', '')}
      ${inputField('vEnd', 'เวลาสิ้นสุด', 'time', '')}
    </div>
    <div class="mt-3"><label class="block text-sm text-muted mb-1.5">ผู้เยี่ยม</label>
      <input value="${esc(visitor)}" disabled class="w-full h-12 px-3.5 rounded-xl border border-line bg-subtle text-ink"></div>
    <div class="mt-3">${inputField('vCaregiverPerson', 'ชื่อผู้ดูแล (ในครอบครัว)', 'text', p.caregiverName || '')}</div>
    <div class="mt-3">${selectField('vRelation', 'ความสัมพันธ์', [['', '-']].concat(RELATIONSHIPS.map(r => [r, r])), '')}</div>`;

  const S2 = `
    <div class="grid grid-cols-2 gap-3">
      ${inputField('vWeight', 'น้ำหนัก (กก.)', 'number', '', 'inputmode="decimal" oninput="calculateBMI()"')}
      ${inputField('vHeight', 'ส่วนสูง (ซม.)', 'number', '', 'inputmode="decimal" oninput="calculateBMI()"')}
    </div>
    <div class="grid grid-cols-2 gap-3 mt-3">
      <div><label class="block text-sm text-muted mb-1.5">BMI</label>
        <input id="vBmi" disabled class="w-full h-12 px-3.5 rounded-xl border border-line bg-subtle font-500"></div>
      <div><label class="block text-sm text-muted mb-1.5">แปลผล</label>
        <div id="vBmiResult" class="w-full h-12 px-3.5 rounded-xl border border-line bg-subtle flex items-center font-500 text-primary">-</div></div>
    </div>`;

  const S3 = `
    ${toggleSwitch('vitalEnabled', 'บันทึกสัญญาณชีพ', 'toggleVitalSection()')}
    <div id="vitalFields" class="hidden mt-3 grid grid-cols-2 gap-3">
      ${inputField('vTemp', 'อุณหภูมิ (°C)', 'number', '', 'inputmode="decimal"')}
      ${inputField('vPulse', 'ชีพจร (ครั้ง/นาที)', 'number', '', 'inputmode="numeric"')}
      ${inputField('vResp', 'การหายใจ (ครั้ง/นาที)', 'number', '', 'inputmode="numeric"')}
      <div class="grid grid-cols-2 gap-2">
        ${inputField('vSys', 'SYS', 'number', '', 'inputmode="numeric"')}
        ${inputField('vDia', 'DIA', 'number', '', 'inputmode="numeric"')}
      </div>
    </div>`;

  const S4 = `
    ${toggleSwitch('mentalEnabled', 'ทำแบบประเมินสุขภาพจิต', 'toggleMentalSection()')}
    <div id="mentalFields" class="hidden mt-3">${mentalSectionHtml()}</div>`;

  const S8 = `
    ${toggleSwitch('olderImageEnabled', 'แนบรูปผู้มีภาวะพึ่งพิง', 'toggleImageSection()')}
    <div id="olderImageField" class="hidden mt-3">
      <div class="flex items-center gap-3">
        <img id="olderImgPreview" class="w-20 h-20 rounded-xl object-cover bg-subtle hidden">
        <label class="btn cursor-pointer h-11 px-4 rounded-xl bg-subtle text-ink font-500 flex items-center gap-2">
          <i data-lucide="image-plus" class="w-5 h-5"></i> เลือกรูป (1 ภาพ)
          <input type="file" accept="image/*" class="hidden" onchange="olderImageChange(event)"></label>
      </div>
    </div>
    <div class="mt-5 pt-4 border-t border-line">
      <div class="flex items-center justify-between mb-2">
        <span class="font-500 text-ink">รูปกิจกรรมการดูแล</span>
        <span class="text-xs text-muted">เลือกแล้ว <span id="serviceImgCount">0</span> / อย่างน้อย ${MIN_SERVICE_IMAGES} ภาพ</span>
      </div>
      <div id="serviceImgPreviews" class="flex flex-wrap gap-2 mb-2"></div>
      <label class="btn cursor-pointer h-11 px-4 rounded-xl bg-primary/10 text-primary font-500 flex items-center justify-center gap-2">
        <i data-lucide="images" class="w-5 h-5"></i> เพิ่มรูปกิจกรรม
        <input type="file" accept="image/*" multiple class="hidden" onchange="serviceImagesChange(event)"></label>
    </div>`;

  const S9 = `
    ${toggleSwitch('locationEnabled', 'บันทึกพิกัดตำแหน่ง', 'toggleLocationSection()')}
    <div id="locationFields" class="hidden mt-3">
      <button type="button" onclick="getCurrentLocation()" class="btn w-full h-11 rounded-xl bg-primary/10 text-primary font-500 flex items-center justify-center gap-2 mb-3">
        <i data-lucide="locate-fixed" class="w-5 h-5"></i> ใช้ตำแหน่งปัจจุบัน</button>
      <div id="leafletMap" class="w-full h-56 rounded-xl border border-line z-0"></div>
      <div class="grid grid-cols-2 gap-3 mt-3">
        ${inputField('vLat', 'Latitude', 'text', '', 'readonly')}
        ${inputField('vLng', 'Longitude', 'text', '', 'readonly')}
      </div>
      <p class="text-xs text-muted mt-1">แตะบนแผนที่หรือลากหมุดเพื่อปรับตำแหน่ง</p>
    </div>`;

  const S10 = `<textarea id="vNote" rows="4" placeholder="บันทึกเพิ่มเติม..." class="w-full p-3.5 rounded-xl border border-line outline-none focus:border-primary resize-none"></textarea>
    <div class="mt-3 p-3 rounded-xl bg-primary/5 border border-primary/15 text-sm text-muted flex items-start gap-2">
      <i data-lucide="info" class="w-4 h-4 text-primary mt-0.5 shrink-0"></i>
      <span>ตรวจสอบความถูกต้องของข้อมูลทุกขั้นตอนก่อนกด "บันทึกการเยี่ยม" — แตะที่หมายเลขขั้นตอนด้านบนเพื่อย้อนกลับไปแก้ไขได้</span>
    </div>`;

  // ----- รวมเป็น 7 ขั้น -----
  container.innerHTML = `
    <!-- หัวข้อผู้ป่วย -->
    <div class="bg-primary text-white rounded-2xl shadow-soft p-4 mb-3 flex items-center gap-3">
      <img src="${esc(p.imageUrl)}" class="w-14 h-14 rounded-xl object-cover bg-black/10 shrink-0">
      <div class="min-w-0">
        <div class="font-600 truncate">${esc(p.fullName)}</div>
        <div class="text-xs text-white/80">${esc(p.patientId)} · อายุ ${p.age !== '' ? esc(p.age) : '-'} ปี · ครั้งที่เยี่ยม ${nextNo}</div>
      </div>
    </div>

    <!-- Stepper + Progress -->
    <div id="vStepperWrap" class="bg-card rounded-2xl shadow-card p-4 mb-3 no-print"></div>

    <form id="visitForm" onsubmit="return false">
      <div class="vstep-body" data-step="1">${stepCard('ข้อมูลการเยี่ยม', 'clipboard-list', S1)}</div>
      <div class="vstep-body hidden" data-step="2">${stepCard('ประเมินสุขภาพแรกรับ', 'stethoscope', subHead('ดัชนีมวลกาย (BMI)') + S2 + subHead('สัญญาณชีพ') + S3)}</div>
      <div class="vstep-body hidden" data-step="3">${stepCard('การประเมินสุขภาพจิต', 'brain', S4)}</div>
      <div class="vstep-body hidden" data-step="4">${stepCard('กิจกรรมการดูแล', 'list-checks',
        subHead('กิจกรรมการช่วยเหลือประจำวัน') + checkboxList('daily', DAILY_ACTS) +
        subHead('กิจกรรมการดูแลสุขภาพพื้นฐาน') + checkboxList('health', HEALTH_ACTS) +
        subHead('กิจกรรมการดูแลด้านอื่น ๆ') + checkboxList('other', OTHER_ACTS))}</div>
      <div class="vstep-body hidden" data-step="5">${stepCard('อัปโหลดรูปภาพ', 'images', S8)}</div>
      <div class="vstep-body hidden" data-step="6">${stepCard('บันทึกพิกัด (Latitude / Longitude)', 'map-pin', S9)}</div>
      <div class="vstep-body hidden" data-step="7">${stepCard('หมายเหตุ', 'edit-3', S10)}</div>

      <div id="vNav"></div>
    </form>`;

  _visitStep = 1;
  renderStepper();
  renderVisitNav();
  refreshIcons();
  fpInit('vDate', { onChange: updateDateTH });
}

// ===============================
// VISIT FORM — STEPPER NAVIGATION
// ===============================
const VISIT_STEPS = [
  { t: 'ข้อมูลการเยี่ยม', icon: 'clipboard-list' },
  { t: 'ประเมินสุขภาพ',   icon: 'stethoscope' },
  { t: 'สุขภาพจิต',       icon: 'brain' },
  { t: 'กิจกรรมการดูแล',  icon: 'list-checks' },
  { t: 'รูปภาพ',          icon: 'images' },
  { t: 'พิกัด',           icon: 'map-pin' },
  { t: 'หมายเหตุ',        icon: 'edit-3' },
];

function stepCard(title, icon, contentHtml) {
  return `<div class="bg-card rounded-2xl shadow-card p-4 mb-3">
      <div class="font-600 text-ink mb-3 flex items-center gap-2"><i data-lucide="${icon}" class="w-5 h-5 text-primary"></i> ${esc(title)}</div>
      ${contentHtml}
    </div>`;
}
function subHead(title) {
  return `<div class="text-sm font-600 text-primary mt-5 mb-2 first:mt-0 flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-primary"></span>${esc(title)}</div>`;
}

function renderStepper() {
  const total = VISIT_STEPS.length, cur = _visitStep;
  let row = '';
  for (let i = 1; i <= total; i++) {
    const done = i < cur, active = i === cur;
    const cls = active ? 'bg-primary text-white border-primary ring-4 ring-primary/25'
      : done ? 'bg-success text-white border-success' : 'bg-card text-muted border-line';
    row += `<button type="button" onclick="goStep(${i})" title="${esc(VISIT_STEPS[i - 1].t)}"
        class="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-600 shrink-0 transition-all ${cls}">
        ${done ? '<i data-lucide="check" class="w-4 h-4"></i>' : i}</button>`;
    if (i < total) row += `<div class="flex-1 h-0.5 mx-1 ${i < cur ? 'bg-primary' : 'bg-line'}"></div>`;
  }
  const pct = Math.round(cur / total * 100);
  $id('vStepperWrap').innerHTML = `
    <div class="flex items-center mb-3">${row}</div>
    <div class="h-2 bg-subtle rounded-full overflow-hidden mb-2"><div class="h-full bg-primary rounded-full transition-all duration-300" style="width:${pct}%"></div></div>
    <div class="flex items-center justify-between">
      <span class="text-sm font-600 text-ink">ขั้นตอนที่ ${cur}/${total} · ${esc(VISIT_STEPS[cur - 1].t)}</span>
      <span class="text-xs text-muted">${pct}%</span>
    </div>`;
  refreshIcons();
}

function renderVisitNav() {
  const total = VISIT_STEPS.length, cur = _visitStep;
  const back = cur > 1
    ? `<button type="button" onclick="prevStep()" class="btn h-12 px-5 rounded-xl bg-subtle text-ink font-500 flex items-center gap-2"><i data-lucide="arrow-left" class="w-5 h-5"></i> ย้อนกลับ</button>`
    : `<button type="button" onclick="navigate('${isAdmin() ? 'patients' : 'dashboard'}')" class="btn h-12 px-5 rounded-xl bg-subtle text-ink font-500 flex items-center gap-2"><i data-lucide="x" class="w-5 h-5"></i> ยกเลิก</button>`;
  const next = cur < total
    ? `<button type="button" onclick="nextStep()" class="btn flex-1 h-12 rounded-xl bg-primary text-white font-500 flex items-center justify-center gap-2">ถัดไป <i data-lucide="arrow-right" class="w-5 h-5"></i></button>`
    : `<button type="button" onclick="saveVisitReport()" class="btn flex-1 h-12 rounded-xl bg-primary text-white font-500 shadow-soft flex items-center justify-center gap-2"><i data-lucide="save" class="w-5 h-5"></i> บันทึกการเยี่ยม</button>`;
  $id('vNav').innerHTML = `<div class="flex gap-2 mt-4 mb-6">${back}${next}</div>`;
  refreshIcons();
}

function goStep(n) {
  const total = VISIT_STEPS.length;
  n = Math.max(1, Math.min(total, n));
  _visitStep = n;
  document.querySelectorAll('.vstep-body').forEach(el => {
    el.classList.toggle('hidden', +el.getAttribute('data-step') !== n);
  });
  renderStepper();
  renderVisitNav();
  window.scrollTo(0, 0);
  if (n === 6 && _leafletMap) setTimeout(() => _leafletMap.invalidateSize(), 150);
}
function nextStep() { if (!validateStep(_visitStep)) return; goStep(_visitStep + 1); }
function prevStep() { goStep(_visitStep - 1); }

/** ตรวจความถูกต้องของแต่ละขั้นก่อนไปต่อ */
function validateStep(step) {
  const val = id => ($id(id) ? $id(id).value.trim() : '');
  if (step === 1 && !val('vStart')) { alertError('กรุณาระบุเวลาเริ่มเยี่ยม'); return false; }
  if (step === 2 && $id('vitalEnabled').checked) {
    for (const id of ['vTemp', 'vPulse', 'vResp', 'vSys', 'vDia'])
      if (!val(id)) { alertError('เปิดบันทึกสัญญาณชีพแล้ว กรุณากรอกให้ครบทุกช่อง'); return false; }
  }
  if (step === 3 && $id('mentalEnabled').checked && validateMentalHealthForm() !== true) return false;
  if (step === 5) {
    if ($id('olderImageEnabled').checked && !_visitOlderFile) { alertError('เปิดแนบรูปผู้ป่วยแล้ว กรุณาเลือกรูป 1 ภาพ'); return false; }
    if (_visitServiceFiles.length < MIN_SERVICE_IMAGES) { alertError('กรุณาอัปโหลดรูปกิจกรรมการดูแลอย่างน้อย ' + MIN_SERVICE_IMAGES + ' ภาพ'); return false; }
  }
  if (step === 6 && $id('locationEnabled').checked && (!val('vLat') || !val('vLng'))) { alertError('เปิดบันทึกพิกัดแล้ว กรุณาระบุตำแหน่งบนแผนที่'); return false; }
  return true;
}

function inputFieldWrap(html) { return html; } // ตัวช่วยจัดวาง (ไม่ทำอะไรพิเศษ)

function mentalSectionHtml() {
  // 2Q
  const q2opts = [{ value: 'ไม่มี', label: 'ไม่มี' }, { value: 'มี', label: 'มี' }];
  let html = `<div class="bg-subtle rounded-xl p-3 mb-3">
    <div class="font-500 text-ink text-sm mb-1">2Q · คัดกรองภาวะซึมเศร้า</div>
    ${questionBlock(1, 'ใน 2 สัปดาห์ที่ผ่านมา (รวมวันนี้) รู้สึกหดหู่ เศร้า หรือท้อแท้สิ้นหวังหรือไม่', radioRow('dep2q1', q2opts, 'calculate2QResult()'))}
    ${questionBlock(2, 'ใน 2 สัปดาห์ที่ผ่านมา (รวมวันนี้) รู้สึกเบื่อ ทำอะไรก็ไม่เพลิดเพลินหรือไม่', radioRow('dep2q2', q2opts, 'calculate2QResult()'))}
    <div class="text-sm mt-1">ผล 2Q: <span id="dep2qResult" class="font-600 text-primary">-</span></div>
  </div>`;

  // 9Q
  html += `<div id="block9Q" class="hidden bg-subtle rounded-xl p-3 mb-3">
    <div class="font-500 text-ink text-sm mb-1">9Q · แบบประเมินโรคซึมเศร้า</div>
    ${DEP9Q.map((t, i) => questionBlock(i + 1, t, radioRow('dep9q' + (i + 1), DEP9Q_OPTS, 'calculate9QTotal()'))).join('')}
    <div class="text-sm mt-2 flex items-center justify-between">
      <span>คะแนนรวม: <span id="dep9qTotal" class="font-600 text-ink">0</span></span>
      <span>ผล: <span id="dep9qResult" class="font-600 text-primary">-</span></span>
    </div>
  </div>`;

  // 8Q
  html += `<div id="block8Q" class="hidden bg-subtle rounded-xl p-3">
    <div class="font-500 text-ink text-sm mb-1">8Q · ประเมินแนวโน้มการฆ่าตัวตาย</div>
    ${SUI8Q.map((q, i) => {
      const idx = i + 1;
      let extra = '';
      if (idx === 3) {
        extra = `<div id="sui8q3ControlBlock" class="hidden mt-2 pl-3 border-l-2 border-primary/30">
          <div class="text-sm text-ink mb-2">ท่านควบคุมความคิดอยากฆ่าตัวตายได้หรือไม่ (หรือคงจะไม่ทำตามความคิดนั้นในขณะนี้)</div>
          ${radioRow('sui8q3control', [{ value: 'ได้', label: 'ได้' }, { value: 'ไม่ได้', label: 'ไม่ได้' }], '')}</div>`;
      }
      return questionBlock(idx, q.t + ` (มี = ${q.w} คะแนน)`,
        radioRow('sui8q' + idx, [{ value: 'ไม่มี', label: 'ไม่มี' }, { value: 'มี', label: 'มี' }], 'calculate8QTotal()'), extra);
    }).join('')}
    <div class="text-sm mt-2 flex items-center justify-between">
      <span>คะแนนรวม: <span id="sui8qTotal" class="font-600 text-ink">0</span></span>
      <span>ผล: <span id="sui8qResult" class="font-600 text-danger">-</span></span>
    </div>
  </div>`;
  return html;
}


// ===============================
// VISIT FORM — UI COMPONENTS
// ===============================
function formSection(num, title, contentHtml, opts) {
  opts = opts || {};
  return `<div class="bg-card rounded-2xl shadow-card mb-3 overflow-hidden">
    <button type="button" class="w-full flex items-center justify-between gap-2 px-4 h-14" onclick="toggleAccordion(this)">
      <span class="flex items-center gap-2.5 min-w-0">
        <span class="w-7 h-7 rounded-lg bg-primary/10 text-primary text-sm font-600 flex items-center justify-center shrink-0">${num}</span>
        <span class="font-500 text-ink text-left truncate">${esc(title)}</span>
      </span>
      <i data-lucide="chevron-down" class="w-5 h-5 text-muted shrink-0" style="${opts.open ? 'transform:rotate(180deg)' : ''}"></i>
    </button>
    <div class="acc-body px-4 pb-4 ${opts.open ? '' : 'hidden'}">${contentHtml}</div>
  </div>`;
}
function toggleAccordion(btn) {
  const body = btn.nextElementSibling;
  const icon = btn.querySelector('i');
  body.classList.toggle('hidden');
  if (icon) icon.style.transform = body.classList.contains('hidden') ? '' : 'rotate(180deg)';
}
function toggleSwitch(id, label, onchange, checked) {
  return `<label class="flex items-center justify-between gap-3 cursor-pointer py-1">
    <span class="font-500 text-ink">${esc(label)}</span>
    <span class="relative inline-flex shrink-0">
      <input type="checkbox" id="${id}" class="peer sr-only" ${checked ? 'checked' : ''} onchange="${onchange}">
      <span class="w-12 h-7 bg-subtle rounded-full peer-checked:bg-primary transition-colors"></span>
      <span class="absolute left-0.5 top-0.5 w-6 h-6 bg-card rounded-full shadow transition-transform peer-checked:translate-x-5"></span>
    </span>
  </label>`;
}
function radioCard(name, value, label, onchange) {
  return `<label class="flex-1 min-w-0">
    <input type="radio" name="${name}" value="${esc(value)}" class="peer sr-only" onchange="${onchange}">
    <span class="block text-center text-sm py-2.5 px-2 rounded-xl border border-line cursor-pointer peer-checked:bg-primary peer-checked:text-white peer-checked:border-primary">${esc(label)}</span>
  </label>`;
}
function radioRow(name, options, onchange) {
  return `<div class="flex gap-2">${options.map(o => radioCard(name, o.value, o.label, onchange)).join('')}</div>`;
}
function questionBlock(no, text, radiosHtml, extraHtml) {
  return `<div class="py-3 border-b border-line last:border-0">
     <div class="text-sm text-ink mb-2"><span class="text-primary font-500">${no}.</span> ${esc(text)}</div>
     ${radiosHtml}${extraHtml || ''}
   </div>`;
}
function checkboxList(name, items) {
  return `<div class="space-y-2">${items.map(t => `
    <label class="flex items-start gap-2.5 p-2.5 rounded-xl border border-line cursor-pointer hover:bg-subtle">
      <input type="checkbox" name="${name}" value="${esc(t)}" class="mt-0.5 w-5 h-5 accent-primary shrink-0">
      <span class="text-sm text-ink">${esc(t)}</span></label>`).join('')}</div>`;
}
function radioVal(name) { const el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }
function checkedValues(name) { return [...document.querySelectorAll('input[name="' + name + '"]:checked')].map(e => e.value); }
function updateDateTH() { $id('vDateTH').textContent = formatThaiDate($id('vDate').value); }


// ===============================
// VISIT FORM — LOGIC (BMI / Toggles)
// ===============================
function calculateBMI() {
  const w = parseFloat($id('vWeight').value), h = parseFloat($id('vHeight').value);
  if (w > 0 && h > 0) {
    const bmi = Math.round(w / Math.pow(h / 100, 2) * 10) / 10;
    $id('vBmi').value = bmi;
    $id('vBmiResult').textContent = interpretBMI(bmi);
  } else { $id('vBmi').value = ''; $id('vBmiResult').textContent = '-'; }
}
function interpretBMI(b) {
  if (b < 18.5) return 'น้ำหนักน้อย';
  if (b < 23) return 'ปกติ';
  if (b < 25) return 'น้ำหนักเกิน';
  if (b < 30) return 'อ้วนระดับ 1';
  return 'อ้วนระดับ 2';
}
function toggleVitalSection() { $id('vitalFields').classList.toggle('hidden', !$id('vitalEnabled').checked); }
function toggleMentalSection() { $id('mentalFields').classList.toggle('hidden', !$id('mentalEnabled').checked); }
function toggleImageSection() { $id('olderImageField').classList.toggle('hidden', !$id('olderImageEnabled').checked); }
function toggleLocationSection() {
  const on = $id('locationEnabled').checked;
  $id('locationFields').classList.toggle('hidden', !on);
  if (on) setTimeout(initLeafletMap, 150);
}


// ===============================
// VISIT FORM — MENTAL HEALTH LOGIC
// ===============================
function calculate2QResult() {
  const q1 = radioVal('dep2q1'), q2 = radioVal('dep2q2');
  const risk = (q1 === 'มี' || q2 === 'มี');
  const result = (q1 && q2) ? (risk ? 'เสี่ยง' : 'ปกติ') : (risk ? 'เสี่ยง' : '-');
  $id('dep2qResult').textContent = result;
  if (risk) {
    $id('block9Q').classList.remove('hidden');
    calculate9QTotal();
  } else {
    $id('block9Q').classList.add('hidden');
    $id('block8Q').classList.add('hidden');
  }
}
function calculate9QTotal() {
  let total = 0, answered = 0;
  for (let i = 1; i <= 9; i++) { const v = radioVal('dep9q' + i); if (v !== '') { total += +v; answered++; } }
  $id('dep9qTotal').textContent = total;
  $id('dep9qResult').textContent = answered ? interpret9Q(total) : '-';
  toggle8QBy9QScore(total);
  return total;
}
function interpret9Q(score) {
  if (score <= 6) return 'ไม่มีภาวะซึมเศร้า';
  if (score <= 12) return 'ซึมเศร้าระดับน้อย';
  if (score <= 18) return 'ซึมเศร้าระดับปานกลาง';
  return 'ซึมเศร้าระดับรุนแรง';
}
function toggle8QBy9QScore(score) {
  const show = score >= 7;
  $id('block8Q').classList.toggle('hidden', !show);
  if (show) calculate8QTotal();
}
function calculate8QTotal() {
  let total = 0, answered = 0;
  for (let i = 1; i <= 8; i++) {
    const v = radioVal('sui8q' + i);
    if (v !== '') { answered++; if (v === 'มี') total += Q8_WEIGHTS[i]; }
  }
  $id('sui8qTotal').textContent = total;
  $id('sui8qResult').textContent = answered ? interpret8Q(total) : '-';

  // คำถามย่อยข้อ 3
  const q3 = radioVal('sui8q3');
  $id('sui8q3ControlBlock').classList.toggle('hidden', q3 !== 'มี');

  // แจ้งเตือนเมื่อคะแนน >= 9 (ระดับกลางขึ้นไป)
  if (total >= 9 && !_alerted8Q) {
    _alerted8Q = true;
    Swal.fire({
      icon: 'warning', title: 'พบความเสี่ยงสูง',
      text: 'พบความเสี่ยงต่อการฆ่าตัวตายระดับกลางขึ้นไป กรุณาประสานบุคลากรสาธารณสุขทันที',
      confirmButtonColor: '#EF4444', customClass: { popup: 'font-sans' }
    });
  }
  if (total < 9) _alerted8Q = false;
  return total;
}
function interpret8Q(score) {
  if (score <= 0) return 'ไม่มีแนวโน้มฆ่าตัวตาย';
  if (score <= 8) return 'แนวโน้มระดับน้อย';
  if (score <= 16) return 'แนวโน้มระดับกลาง';
  return 'แนวโน้มระดับรุนแรง';
}
function validateMentalHealthForm() {
  if (!$id('mentalEnabled').checked) return true;
  const q1 = radioVal('dep2q1'), q2 = radioVal('dep2q2');
  if (!q1 || !q2) { alertError('กรุณาตอบแบบคัดกรอง 2Q ให้ครบทั้ง 2 ข้อ'); return false; }
  const risk = (q1 === 'มี' || q2 === 'มี');
  if (!risk) return true; // ปกติ ไม่ต้องทำ 9Q/8Q
  for (let i = 1; i <= 9; i++) if (radioVal('dep9q' + i) === '') { alertError('กรุณาตอบแบบประเมิน 9Q ให้ครบ (ข้อ ' + i + ')'); return false; }
  let total9 = 0; for (let i = 1; i <= 9; i++) total9 += +radioVal('dep9q' + i);
  if (total9 < 7) return true; // 0-6 ไม่ต้องทำ 8Q
  for (let i = 1; i <= 8; i++) if (radioVal('sui8q' + i) === '') { alertError('กรุณาตอบแบบประเมิน 8Q ให้ครบ (ข้อ ' + i + ')'); return false; }
  if (radioVal('sui8q3') === 'มี' && radioVal('sui8q3control') === '') { alertError('กรุณาตอบคำถามย่อยของข้อ 3 (การควบคุมความคิด)'); return false; }
  return true;
}


// ===============================
// VISIT FORM — IMAGES
// ===============================
function olderImageChange(e) {
  const f = e.target.files[0]; if (!f) return;
  _visitOlderFile = f;
  const p = $id('olderImgPreview'); p.src = URL.createObjectURL(f); p.classList.remove('hidden');
}
function serviceImagesChange(e) {
  [...e.target.files].forEach(f => _visitServiceFiles.push(f));
  e.target.value = '';
  renderServicePreviews();
}
function removeServiceImage(idx) { _visitServiceFiles.splice(idx, 1); renderServicePreviews(); }
function renderServicePreviews() {
  $id('serviceImgPreviews').innerHTML = _visitServiceFiles.map((f, i) => `
    <div class="relative w-20 h-20">
      <img src="${URL.createObjectURL(f)}" class="w-20 h-20 rounded-xl object-cover">
      <button type="button" onclick="removeServiceImage(${i})" class="absolute -top-1.5 -right-1.5 w-6 h-6 bg-danger text-white rounded-full flex items-center justify-center shadow">
        <i data-lucide="x" class="w-4 h-4"></i></button>
    </div>`).join('');
  $id('serviceImgCount').textContent = _visitServiceFiles.length;
  refreshIcons();
}
async function uploadManyImages(files, folderKey) {
  const arr = [];
  for (const f of files) arr.push(await fileToBase64(f));
  const res = await api('uploadImage', { images: arr, folderKey: folderKey || 'DRIVE_FOLDER_SERVICE' }, { loadingText: 'กำลังอัปโหลดรูป...' });
  if (res.success) return res.data.urls;
  throw new Error(res.message || 'อัปโหลดรูปไม่สำเร็จ');
}


// ===============================
// VISIT FORM — LEAFLET MAP
// ===============================
function initLeafletMap() {
  if (_leafletMap) { _leafletMap.invalidateSize(); return; }
  const start = [16.5449, 104.7235]; // ค่าเริ่มต้น
  _leafletMap = L.map('leafletMap').setView(start, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(_leafletMap);
  _leafletMarker = L.marker(start, { draggable: true }).addTo(_leafletMap);
  _leafletMarker.on('dragend', () => { const p = _leafletMarker.getLatLng(); setLatLng(p.lat, p.lng); });
  _leafletMap.on('click', (e) => { _leafletMarker.setLatLng(e.latlng); setLatLng(e.latlng.lat, e.latlng.lng); });
  setTimeout(() => _leafletMap.invalidateSize(), 200);
}
function setLatLng(lat, lng) { $id('vLat').value = (+lat).toFixed(6); $id('vLng').value = (+lng).toFixed(6); }
function getCurrentLocation() {
  if (!navigator.geolocation) return alertError('เบราว์เซอร์ไม่รองรับการระบุตำแหน่ง');
  showLoading('กำลังขอตำแหน่ง...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      hideLoading();
      const { latitude, longitude } = pos.coords;
      if (!_leafletMap) initLeafletMap();
      _leafletMap.setView([latitude, longitude], 16);
      _leafletMarker.setLatLng([latitude, longitude]);
      setLatLng(latitude, longitude);
    },
    err => { hideLoading(); alertError('ระบุตำแหน่งไม่ได้: ' + err.message); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}


// ===============================
// VISIT FORM — SAVE
// ===============================
async function saveVisitReport() {
  const val = id => ($id(id) ? $id(id).value.trim() : '');

  // S1
  const startTime = val('vStart');
  if (!startTime) { goStep(1); return alertError('กรุณาระบุเวลาเริ่มเยี่ยม'); }

  // S3 สัญญาณชีพ
  const vitalEnabled = $id('vitalEnabled').checked;
  if (vitalEnabled) {
    for (const id of ['vTemp', 'vPulse', 'vResp', 'vSys', 'vDia']) {
      if (!val(id)) { goStep(2); return alertError('เปิดบันทึกสัญญาณชีพแล้ว กรุณากรอกให้ครบทุกช่อง'); }
    }
  }

  // S4 สุขภาพจิต
  if (validateMentalHealthForm() !== true) { goStep(3); return; }

  // S8 รูปภาพ
  const olderEnabled = $id('olderImageEnabled').checked;
  if (olderEnabled && !_visitOlderFile) { goStep(5); return alertError('เปิดแนบรูปผู้ป่วยแล้ว กรุณาเลือกรูป 1 ภาพ'); }
  if (_visitServiceFiles.length < MIN_SERVICE_IMAGES) {
    goStep(5); return alertError('กรุณาอัปโหลดรูปกิจกรรมการดูแลอย่างน้อย ' + MIN_SERVICE_IMAGES + ' ภาพ');
  }

  // S9 พิกัด
  const locationEnabled = $id('locationEnabled').checked;
  if (locationEnabled && (!val('vLat') || !val('vLng'))) {
    goStep(6); return alertError('เปิดบันทึกพิกัดแล้ว กรุณาระบุตำแหน่งบนแผนที่');
  }

  // อัปโหลดรูป
  let olderImageUrl = '', serviceImageUrls = [];
  try {
    if (olderEnabled && _visitOlderFile) olderImageUrl = await uploadOneImage(_visitOlderFile);
    if (_visitServiceFiles.length) serviceImageUrls = await uploadManyImages(_visitServiceFiles);
  } catch (e) { return alertError(e.message); }

  // สร้าง payload
  const payload = {
    patientId: _visitPatientId,
    visitDate: val('vDate'), startTime: startTime, endTime: val('vEnd'),
    caregiverPersonName: val('vCaregiverPerson'), relationship: val('vRelation'),
    weight: val('vWeight'), height: val('vHeight'),
    vitalEnabled: vitalEnabled,
    temperature: val('vTemp'), pulse: val('vPulse'), respiration: val('vResp'),
    systolic: val('vSys'), diastolic: val('vDia'),
    mentalEnabled: $id('mentalEnabled').checked,
    dailyActivities: checkedValues('daily'),
    healthActivities: checkedValues('health'),
    otherActivities: checkedValues('other'),
    olderImageEnabled: olderEnabled, olderImageUrl: olderImageUrl,
    serviceImageUrls: serviceImageUrls,
    locationEnabled: locationEnabled, latitude: val('vLat'), longitude: val('vLng'),
    note: val('vNote')
  };

  if (payload.mentalEnabled) {
    payload.depression2Q1 = radioVal('dep2q1');
    payload.depression2Q2 = radioVal('dep2q2');
    payload.depression2QResult = $id('dep2qResult').textContent;
    let total9 = 0;
    for (let i = 1; i <= 9; i++) { const v = radioVal('dep9q' + i); payload['depression9Q' + i] = v; total9 += (+v || 0); }
    payload.depression9QTotal = total9;
    let total8 = 0;
    for (let i = 1; i <= 8; i++) { const v = radioVal('sui8q' + i); payload['suicide8Q' + i] = v; if (v === 'มี') total8 += Q8_WEIGHTS[i]; }
    payload.suicide8Q3Control = radioVal('sui8q3control');
    payload.suicide8QTotal = total8;
  }

  const res = await api('createVisitReport', payload, { loadingText: 'กำลังบันทึกการเยี่ยม...' });
  if (res.success) {
    await Swal.fire({ icon: 'success', title: 'บันทึกสำเร็จ', text: 'บันทึกการเยี่ยมครั้งที่ ' + res.data.visitNo + ' เรียบร้อยแล้ว', confirmButtonColor: '#2563EB', customClass: { popup: 'font-sans' } });
    navigate('history', { patientId: _visitPatientId });
  }
}


// ===============================
// CSV EXPORT (ใช้ร่วม)
// ===============================
function exportCSV(filename, columns, rows) {
  const q = v => { v = (v == null ? '' : String(v)).replace(/"/g, '""'); return '"' + v + '"'; };
  const head = columns.map(c => q(c.label)).join(',');
  const body = rows.map(r => columns.map(c => q(c.value ? c.value(r) : r[c.key])).join(',')).join('\r\n');
  const csv = '\uFEFF' + head + '\r\n' + body; // BOM เพื่อให้ Excel อ่านภาษาไทยถูก
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}


// ===============================
// VIEW: ประวัติการเยี่ยมรายบุคคล (Timeline)
// ===============================
let _historyData = null;
let _historyPickerList = [];

async function viewHistory(container, params) {
  if (params && params.patientId) return loadHistory(container, params.patientId);

  // ยังไม่เลือกผู้ป่วย → แสดงตัวเลือก
  container.innerHTML = `<div id="hsPicker"></div>`;
  const res = await api(isAdmin() ? 'getPatients' : 'getAssignedPatients', {}, { loadingText: 'กำลังโหลด...' });
  const list = res.success ? (res.data || []) : [];
  if (!list.length) {
    $id('hsPicker').innerHTML = emptyState(isAdmin() ? 'ยังไม่มีผู้ป่วยในระบบ' : 'คุณยังไม่มีเคสที่ได้รับมอบหมาย');
    refreshIcons(); return;
  }
  _historyPickerList = list;
  $id('hsPicker').innerHTML = `
    <div class="relative mb-3">
      <i data-lucide="search" class="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2"></i>
      <input id="hsSearch" type="text" placeholder="ค้นหาผู้ป่วยเพื่อดูประวัติ" class="w-full h-11 pl-10 pr-3 rounded-xl border border-line focus:border-primary outline-none">
    </div>
    <div id="hsList" class="space-y-2"></div>`;
  refreshIcons();
  $id('hsSearch').addEventListener('input', debounce(renderHistoryPicker, 200));
  renderHistoryPicker();
}
function renderHistoryPicker() {
  const q = ($id('hsSearch') ? $id('hsSearch').value.trim().toLowerCase() : '');
  let rows = _historyPickerList;
  if (q) rows = rows.filter(p => [p.fullName, p.pid, p.patientId].some(v => String(v).toLowerCase().includes(q)));
  $id('hsList').innerHTML = rows.length ? rows.map(p => `
    <button onclick="navigate('history', { patientId: '${esc(p.patientId)}' })"
      class="w-full bg-card rounded-2xl shadow-card p-3 flex items-center gap-3 text-left hover:bg-subtle">
      <img src="${esc(p.imageUrl)}" class="w-11 h-11 rounded-xl object-cover bg-subtle shrink-0">
      <div class="flex-1 min-w-0"><div class="font-500 text-ink truncate">${esc(p.patientName || p.fullName)}</div>
        <div class="text-xs text-muted">${esc(p.patientId)} · บ้าน ${esc(p.houseNo || '-')} หมู่ ${esc(p.moo || '-')}</div></div>
      <i data-lucide="chevron-right" class="w-5 h-5 text-muted shrink-0"></i>
    </button>`).join('') : emptyState('ไม่พบผู้ป่วย');
  refreshIcons();
}

async function loadHistory(container, patientId) {
  const res = await api('getVisitReportByPatient', { patientId }, { loadingText: 'กำลังโหลดประวัติ...' });
  if (!res.success) { container.innerHTML = emptyState(res.message || 'โหลดข้อมูลไม่สำเร็จ'); refreshIcons(); return; }
  _historyData = res.data;
  const p = res.data.patient;
  const visits = (res.data.visits || []).slice().reverse(); // ใหม่สุดก่อน

  const actionBar = `<div class="flex flex-wrap gap-2 mb-4 no-print">
      <button onclick="navigate('history')" class="btn h-10 px-4 rounded-xl bg-subtle text-ink font-500 flex items-center gap-2"><i data-lucide="arrow-left" class="w-4 h-4"></i> ย้อนกลับ</button>
      <button onclick="printHistory()" class="btn h-10 px-4 rounded-xl bg-primary/10 text-primary font-500 flex items-center gap-2"><i data-lucide="printer" class="w-4 h-4"></i> พิมพ์รายงาน</button>
      <button onclick="exportHistoryCSV()" class="btn h-10 px-4 rounded-xl bg-success/10 text-success font-500 flex items-center gap-2"><i data-lucide="file-down" class="w-4 h-4"></i> Export CSV</button>
    </div>`;

  const timeline = visits.length
    ? `<div class="space-y-3">${visits.map(renderVisitCard).join('')}</div>`
    : emptyState('ยังไม่มีประวัติการเยี่ยม');

  container.innerHTML = actionBar + renderHistoryHeader(p, res.data.totalVisits || 0, res.data.lastVisitDate) + timeline;
  refreshIcons();
}

function renderHistoryHeader(p, totalVisits, lastVisitDate) {
  const row = (l, v) => `<div class="flex justify-between gap-2 text-sm py-0.5"><span class="text-muted">${esc(l)}</span><span class="text-ink font-500 text-right">${esc(v == null || v === '' ? '-' : v)}</span></div>`;
  return `<div class="bg-card rounded-2xl shadow-card p-4 mb-4">
      <div class="flex items-center gap-3 mb-3">
        <img src="${esc(p.imageUrl)}" class="w-16 h-16 rounded-2xl object-cover bg-subtle">
        <div class="min-w-0"><div class="font-600 text-ink truncate">${esc(p.fullName)}</div>
          <div class="text-xs text-muted">${esc(p.patientId)} · ${esc(p.pid)}</div></div>
      </div>
      <div class="grid grid-cols-2 gap-x-4">
        ${row('อายุ', p.age !== '' ? p.age + ' ปี' : '-')}
        ${row('เพศ', p.gender)}
        ${row('บ้าน/หมู่', (p.houseNo || '-') + ' / ' + (p.moo || '-'))}
        ${row('ผู้ดูแล (ครอบครัว)', p.caregiverName)}
        ${row('เบอร์โทร', p.caregiverPhone)}
        ${row('เยี่ยมทั้งหมด', totalVisits + ' ครั้ง')}
        ${row('เยี่ยมล่าสุด', lastVisitDate ? formatThaiDate(lastVisitDate) : '-')}
      </div>
    </div>`;
}

function chip(text, color) {
  color = color || '#2563EB';
  return `<span class="inline-block text-xs px-2.5 py-1 rounded-full mr-1.5 mb-1.5" style="background:${color}1A;color:${color}">${esc(text)}</span>`;
}
function resultColor(text) {
  text = String(text || '');
  if (/รุนแรง|เสี่ยง/.test(text)) return '#EF4444';
  if (/ปานกลาง|กลาง|น้อย|เกิน|อ้วน/.test(text)) return '#F59E0B';
  return '#22C55E';
}
function sectionLine(label, html) {
  return `<div><div class="text-xs text-muted mb-1">${esc(label)}</div><div class="text-sm text-ink">${html}</div></div>`;
}
function renderVisitCard(v) {
  let inner = `<div class="text-sm text-muted">เวลา ${esc(formatTime(v.startTime) || '-')}${v.endTime ? (' - ' + esc(formatTime(v.endTime))) : ''} น.</div>`;
  inner += `<div class="text-sm"><span class="text-muted">ผู้เยี่ยม:</span> <span class="font-500">${esc(v.caregiverName || '-')}</span>${v.caregiverPersonName ? ` · <span class="text-muted">ผู้ดูแล:</span> ${esc(v.caregiverPersonName)}${v.relationship ? ' (' + esc(v.relationship) + ')' : ''}` : ''}</div>`;

  if (v.bmi !== '' && v.bmi != null) {
    inner += sectionLine('BMI', `${esc(v.bmi)} · <span class="font-500" style="color:${resultColor(v.bmiResult)}">${esc(v.bmiResult)}</span>`);
  }
  if (v.vitalEnabled) {
    const items = [];
    if (v.temperature !== '' && v.temperature != null) items.push('อุณหภูมิ ' + v.temperature + '°C');
    if (v.pulse !== '' && v.pulse != null) items.push('ชีพจร ' + v.pulse);
    if (v.respiration !== '' && v.respiration != null) items.push('หายใจ ' + v.respiration);
    if ((v.systolic !== '' && v.systolic != null) || (v.diastolic !== '' && v.diastolic != null)) items.push('ความดัน ' + v.systolic + '/' + v.diastolic);
    inner += sectionLine('สัญญาณชีพ', items.map(t => chip(t)).join('') || '-');
  }
  if (v.mentalEnabled) {
    let m = '';
    if (v.depression2QResult) m += chip('2Q: ' + v.depression2QResult, resultColor(v.depression2QResult));
    if (v.depression9QResult) m += chip('9Q: ' + v.depression9QTotal + ' (' + v.depression9QResult + ')', resultColor(v.depression9QResult));
    if (v.suicide8QResult) m += chip('8Q: ' + v.suicide8QTotal + ' (' + v.suicide8QResult + ')', resultColor(v.suicide8QResult));
    if (m) inner += sectionLine('สุขภาพจิต', m);
  }
  const acts = [].concat(v.dailyActivities || [], v.healthActivities || [], v.otherActivities || []);
  if (acts.length) inner += sectionLine('กิจกรรมการดูแล', acts.map(a => chip(a, '#64748B')).join(''));

  let imgs = '';
  if (v.olderImageEnabled && v.olderImageUrl) imgs += `<img src="${esc(v.olderImageUrl)}" class="w-20 h-20 rounded-xl object-cover">`;
  (v.serviceImageUrls || []).forEach(u => { if (u) imgs += `<img src="${esc(u)}" class="w-20 h-20 rounded-xl object-cover">`; });
  if (imgs) inner += `<div><div class="text-xs text-muted mb-1">รูปภาพ</div><div class="flex flex-wrap gap-2">${imgs}</div></div>`;

  if (v.locationEnabled && v.latitude && v.longitude) {
    const lat = v.latitude, lng = v.longitude;
    inner += `<div><div class="text-xs text-muted mb-1">พิกัด</div>
        <iframe class="w-full h-40 rounded-xl border border-line" loading="lazy"
          src="https://www.openstreetmap.org/export/embed.html?bbox=${(+lng - 0.004)}%2C${(+lat - 0.0025)}%2C${(+lng + 0.004)}%2C${(+lat + 0.0025)}&layer=mapnik&marker=${lat}%2C${lng}"></iframe>
        <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" class="text-xs text-primary mt-1 inline-flex items-center gap-1"><i data-lucide="external-link" class="w-3.5 h-3.5"></i> เปิดใน Google Maps</a></div>`;
  }
  if (v.note) inner += sectionLine('หมายเหตุ', esc(v.note));

  return `<div class="bg-card rounded-2xl shadow-card overflow-hidden">
      <div class="bg-primary/5 px-4 py-3 flex items-center justify-between">
        <span class="flex items-center gap-2"><span class="w-7 h-7 rounded-lg bg-primary text-white text-sm font-600 flex items-center justify-center">${esc(v.visitNo)}</span><span class="font-500 text-ink">ครั้งที่ ${esc(v.visitNo)}</span></span>
        <span class="text-sm text-muted">${formatThaiDate(v.visitDate)}</span>
      </div>
      <div class="p-4 space-y-3">${inner}</div>
    </div>`;
}
function printHistory() { window.print(); }
function exportHistoryCSV() {
  if (!_historyData) return;
  const cols = [
    { label: 'ครั้งที่', key: 'visitNo' },
    { label: 'วันที่', value: v => formatThaiDate(v.visitDate) },
    { label: 'เวลาเริ่ม', value: v => formatTime(v.startTime) }, { label: 'เวลาสิ้นสุด', value: v => formatTime(v.endTime) },
    { label: 'ผู้เยี่ยม', key: 'caregiverName' }, { label: 'ผู้ดูแล', key: 'caregiverPersonName' },
    { label: 'ความสัมพันธ์', key: 'relationship' },
    { label: 'น้ำหนัก', key: 'weight' }, { label: 'ส่วนสูง', key: 'height' },
    { label: 'BMI', key: 'bmi' }, { label: 'แปลผล BMI', key: 'bmiResult' },
    { label: 'อุณหภูมิ', key: 'temperature' }, { label: 'ชีพจร', key: 'pulse' }, { label: 'การหายใจ', key: 'respiration' },
    { label: 'SYS', key: 'systolic' }, { label: 'DIA', key: 'diastolic' },
    { label: '2Q', key: 'depression2QResult' },
    { label: '9Q คะแนน', key: 'depression9QTotal' }, { label: '9Q ผล', key: 'depression9QResult' },
    { label: '8Q คะแนน', key: 'suicide8QTotal' }, { label: '8Q ผล', key: 'suicide8QResult' },
    { label: 'กิจกรรมประจำวัน', value: v => (v.dailyActivities || []).join(' | ') },
    { label: 'สุขภาพพื้นฐาน', value: v => (v.healthActivities || []).join(' | ') },
    { label: 'กิจกรรมอื่นๆ', value: v => (v.otherActivities || []).join(' | ') },
    { label: 'Latitude', key: 'latitude' }, { label: 'Longitude', key: 'longitude' },
    { label: 'หมายเหตุ', key: 'note' }
  ];
  exportCSV('ประวัติการเยี่ยม_' + _historyData.patient.fullName + '.csv', cols, _historyData.visits || []);
}


// ===============================
// VIEW: เคสที่ได้รับมอบหมาย (Member)
// ===============================
let _assignedList = [];
async function viewAssigned(container) {
  container.innerHTML = `
    <div class="relative mb-4">
      <i data-lucide="search" class="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2"></i>
      <input id="agSearch" type="text" placeholder="ค้นหาผู้ป่วย" class="w-full h-11 pl-10 pr-3 rounded-xl border border-line focus:border-primary outline-none">
    </div>
    <div id="agList"></div>`;
  refreshIcons();
  $id('agSearch').addEventListener('input', debounce(renderAssignedList, 200));
  $id('agList').innerHTML = listSkeleton();
  const res = await api('getAssignedPatients', {}, { loading: false });
  _assignedList = res.success ? (res.data || []) : [];
  renderAssignedList();
}
function renderAssignedList() {
  const q = ($id('agSearch') ? $id('agSearch').value.trim().toLowerCase() : '');
  let rows = _assignedList;
  if (q) rows = rows.filter(p => [p.patientName, p.pid].some(v => String(v).toLowerCase().includes(q)));
  if (!rows.length) { $id('agList').innerHTML = emptyState('ไม่มีเคสที่ได้รับมอบหมาย'); refreshIcons(); return; }

  $id('agList').innerHTML = `<div class="space-y-3">` + rows.map(p => `
    <div class="bg-card rounded-2xl shadow-card p-4">
      <div class="flex items-center gap-3">
        <img src="${esc(p.imageUrl)}" class="w-14 h-14 rounded-xl object-cover bg-subtle shrink-0">
        <div class="flex-1 min-w-0">
          <div class="font-500 text-ink truncate">${esc(p.patientName)}</div>
          <div class="text-xs text-muted mt-0.5">${esc(p.gender || '-')} · อายุ ${p.age !== '' ? esc(p.age) + ' ปี' : '-'} · บ้าน ${esc(p.houseNo || '-')} หมู่ ${esc(p.moo || '-')}</div>
          ${p.caregiverPersonName ? `<div class="text-xs text-muted mt-0.5">ผู้ดูแล: ${esc(p.caregiverPersonName)} ${p.caregiverPhone ? '· ' + esc(p.caregiverPhone) : ''}</div>` : ''}
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 mt-3">
        <button onclick="navigate('visitForm', { patientId: '${esc(p.patientId)}' })" class="btn h-10 rounded-xl bg-primary text-white font-500 flex items-center justify-center gap-1.5"><i data-lucide="file-plus-2" class="w-4 h-4"></i> บันทึกเยี่ยม</button>
        <button onclick="navigate('history', { patientId: '${esc(p.patientId)}' })" class="btn h-10 rounded-xl bg-primary/10 text-primary font-500 flex items-center justify-center gap-1.5"><i data-lucide="history" class="w-4 h-4"></i> ดูประวัติ</button>
      </div>
    </div>`).join('') + `</div>`;
  refreshIcons();
}


// ===============================
// VIEW: โปรไฟล์ของฉัน
// ===============================
async function viewProfile(container) {
  const u = getUser();
  const profRow = (l, v) => `<div class="flex justify-between gap-2 py-2 border-b border-line last:border-0"><span class="text-muted text-sm">${esc(l)}</span><span class="text-ink text-sm font-500">${esc(v || '-')}</span></div>`;
  container.innerHTML = `
    <div class="bg-card rounded-2xl shadow-card p-6 text-center mb-3">
      <div class="w-20 h-20 mx-auto rounded-full bg-primary/10 text-primary text-3xl font-600 flex items-center justify-center mb-3">${esc((u.fullName || u.username || 'U').charAt(0).toUpperCase())}</div>
      <div class="font-600 text-lg text-ink">${esc(u.fullName || '-')}</div>
      <div class="text-sm text-muted">${isAdmin() ? 'ผู้ดูแลระบบ' : 'Care Giver'}</div>
    </div>
    <div class="bg-card rounded-2xl shadow-card p-4">
      ${profRow('ชื่อผู้ใช้', u.username)}
      ${profRow('สิทธิ์การใช้งาน', isAdmin() ? 'admin' : 'member')}
      ${u.caregiverCode ? profRow('รหัส Care Giver', u.caregiverCode) : ''}
    </div>
    <div id="profStats" class="grid grid-cols-2 gap-3 mt-3"></div>
    <button onclick="logout()" class="btn w-full h-12 rounded-xl bg-danger/10 text-danger font-500 mt-4 flex items-center justify-center gap-2"><i data-lucide="log-out" class="w-5 h-5"></i> ออกจากระบบ</button>`;
  refreshIcons();

  if (!isAdmin()) {
    const res = await api('getDashboardSummary', {}, { loading: false });
    if (res.success) {
      const d = res.data;
      $id('profStats').innerHTML =
        statCard('เคสที่รับมอบหมาย', d.assignedCount, 'users', '#2563EB') +
        statCard('เยี่ยมเดือนนี้', d.visitsThisMonth, 'calendar-range', '#60A5FA');
      refreshIcons();
    }
  }
}


// ===============================
// VIEW: รายงานรายวัน
// ===============================
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

let _dailyData = null;

async function viewDailyReport(container) {
  let cgOptions = '<option value="">ทุก Care Giver</option>';
  if (isAdmin()) {
    const r = await api('getCareGivers', {}, { loading: false });
    if (r.success) cgOptions += (r.data || []).map(c => `<option value="${esc(c.caregiverCode)}">${esc(c.caregiverCode)} · ${esc(c.fullName)}</option>`).join('');
  }
  container.innerHTML = `
    <div class="bg-card rounded-2xl shadow-card p-4 mb-4 no-print">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label class="block text-sm text-muted mb-1.5">วันที่</label>
          <input id="drDate" type="text" value="${todayISO()}" class="w-full h-11 px-3 rounded-xl border border-line outline-none focus:border-primary"></div>
        ${isAdmin() ? `<div><label class="block text-sm text-muted mb-1.5">Care Giver</label>
          <select id="drCg" class="w-full h-11 px-3 rounded-xl border border-line bg-card">${cgOptions}</select></div>` : ''}
        <div><label class="block text-sm text-muted mb-1.5">หมู่</label>
          <input id="drMoo" type="text" placeholder="ทุกหมู่" class="w-full h-11 px-3 rounded-xl border border-line outline-none focus:border-primary"></div>
        <div><label class="block text-sm text-muted mb-1.5">ค้นหาผู้ป่วย</label>
          <input id="drSearch" type="text" placeholder="ชื่อผู้ป่วย" class="w-full h-11 px-3 rounded-xl border border-line outline-none focus:border-primary"></div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="loadDailyReport()" class="btn flex-1 h-11 rounded-xl bg-primary text-white font-500 flex items-center justify-center gap-2"><i data-lucide="search" class="w-5 h-5"></i> ดูรายงาน</button>
        <button onclick="exportDailyCSV()" class="btn h-11 px-4 rounded-xl bg-success/10 text-success font-500 flex items-center gap-2"><i data-lucide="file-down" class="w-5 h-5"></i> CSV</button>
        <button onclick="window.print()" class="btn h-11 px-4 rounded-xl bg-primary/10 text-primary font-500 flex items-center gap-2"><i data-lucide="printer" class="w-5 h-5"></i></button>
      </div>
    </div>
    <div id="drResult"></div>`;
  refreshIcons();
  fpInit('drDate', { altInputClass: DATE_CLS_SM });
  loadDailyReport();
}
async function loadDailyReport() {
  const data = { date: $id('drDate').value, moo: $id('drMoo').value.trim(), search: $id('drSearch').value.trim() };
  if (isAdmin() && $id('drCg')) data.caregiverCode = $id('drCg').value;
  $id('drResult').innerHTML = listSkeleton();
  const res = await api('getDailyReport', data, { loading: false });
  if (!res.success) { $id('drResult').innerHTML = emptyState('โหลดรายงานไม่สำเร็จ'); refreshIcons(); return; }
  _dailyData = res.data;
  renderDailyReport();
}
function renderDailyReport() {
  const d = _dailyData;
  const head = `<div class="bg-primary text-white rounded-2xl p-4 mb-3 flex items-center justify-between">
      <div><div class="text-sm text-white/80">รายงานการเยี่ยมวันที่</div><div class="font-600">${formatThaiDate(d.date)}</div></div>
      <div class="text-right"><div class="text-3xl font-600 leading-none">${d.total}</div><div class="text-xs text-white/80">ครั้ง</div></div>
    </div>`;
  if (!d.visits.length) { $id('drResult').innerHTML = head + emptyState('ไม่มีการเยี่ยมในวันที่เลือก'); refreshIcons(); return; }
  const list = d.visits.map(v => {
    const acts = [].concat(v.dailyActivities || [], v.healthActivities || [], v.otherActivities || []);
    return `<div class="bg-card rounded-2xl shadow-card p-4">
        <div class="flex items-center justify-between gap-2">
          <div class="font-500 text-ink truncate">${esc(v.patientName)}</div>
          <span class="text-xs text-muted shrink-0">${esc(formatTime(v.startTime))}${v.endTime ? '-' + esc(formatTime(v.endTime)) : ''}</span>
        </div>
        <div class="text-xs text-muted mt-0.5">ครั้งที่ ${esc(v.visitNo)} · ผู้เยี่ยม ${esc(v.caregiverName)}</div>
        ${acts.length ? `<div class="mt-2">${acts.slice(0, 6).map(a => chip(a, '#64748B')).join('')}${acts.length > 6 ? `<span class="text-xs text-muted">+${acts.length - 6}</span>` : ''}</div>` : ''}
        <div class="flex items-center gap-3 mt-2 text-xs">
          ${(v.serviceImageUrls && v.serviceImageUrls.length) ? `<span class="text-success inline-flex items-center gap-1"><i data-lucide="image" class="w-3.5 h-3.5"></i> ${v.serviceImageUrls.length} รูป</span>` : ''}
          ${v.locationEnabled && v.latitude ? `<span class="text-primary inline-flex items-center gap-1"><i data-lucide="map-pin" class="w-3.5 h-3.5"></i> มีพิกัด</span>` : ''}
          <button onclick="navigate('history', { patientId: '${esc(v.patientId)}' })" class="text-primary inline-flex items-center gap-1 ml-auto no-print"><i data-lucide="history" class="w-3.5 h-3.5"></i> ประวัติ</button>
        </div>
      </div>`;
  }).join('');
  $id('drResult').innerHTML = head + `<div class="space-y-3">${list}</div>`;
  refreshIcons();
}
function exportDailyCSV() {
  if (!_dailyData || !_dailyData.visits.length) return alertError('ไม่มีข้อมูลสำหรับ Export');
  const cols = [
    { label: 'ครั้งที่', key: 'visitNo' }, { label: 'ผู้ป่วย', key: 'patientName' }, { label: 'PID', key: 'pid' },
    { label: 'ผู้เยี่ยม', key: 'caregiverName' }, { label: 'เวลาเริ่ม', value: v => formatTime(v.startTime) }, { label: 'เวลาสิ้นสุด', value: v => formatTime(v.endTime) },
    { label: 'BMI', key: 'bmi' }, { label: 'แปลผล', key: 'bmiResult' },
    { label: '9Q ผล', key: 'depression9QResult' }, { label: '8Q ผล', key: 'suicide8QResult' },
    { label: 'กิจกรรมประจำวัน', value: v => (v.dailyActivities || []).join(' | ') },
    { label: 'สุขภาพพื้นฐาน', value: v => (v.healthActivities || []).join(' | ') },
    { label: 'อื่นๆ', value: v => (v.otherActivities || []).join(' | ') },
    { label: 'Latitude', key: 'latitude' }, { label: 'Longitude', key: 'longitude' }, { label: 'หมายเหตุ', key: 'note' }
  ];
  exportCSV('รายงานรายวัน_' + _dailyData.date + '.csv', cols, _dailyData.visits);
}


// ===============================
// VIEW: รายงานรายเดือน
// ===============================
let _monthlyData = null;

async function viewMonthlyReport(container) {
  let cgOptions = '<option value="">ทุก Care Giver</option>';
  if (isAdmin()) {
    const r = await api('getCareGivers', {}, { loading: false });
    if (r.success) cgOptions += (r.data || []).map(c => `<option value="${esc(c.caregiverCode)}">${esc(c.caregiverCode)} · ${esc(c.fullName)}</option>`).join('');
  }
  const now = new Date();
  const curYearTH = now.getFullYear() + 543;
  const monthOpts = THAI_MONTHS.map((m, i) => `<option value="${i + 1}" ${i === now.getMonth() ? 'selected' : ''}>${m}</option>`).join('');
  const yearOpts = [0, 1, 2, 3, 4].map(k => { const y = curYearTH - k; return `<option value="${y}">${y}</option>`; }).join('');

  container.innerHTML = `
    <div class="bg-card rounded-2xl shadow-card p-4 mb-4 no-print">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-sm text-muted mb-1.5">เดือน</label>
          <select id="mrMonth" class="w-full h-11 px-3 rounded-xl border border-line bg-card">${monthOpts}</select></div>
        <div><label class="block text-sm text-muted mb-1.5">ปี (พ.ศ.)</label>
          <select id="mrYear" class="w-full h-11 px-3 rounded-xl border border-line bg-card">${yearOpts}</select></div>
        ${isAdmin() ? `<div><label class="block text-sm text-muted mb-1.5">Care Giver</label>
          <select id="mrCg" class="w-full h-11 px-3 rounded-xl border border-line bg-card">${cgOptions}</select></div>` : ''}
        <div><label class="block text-sm text-muted mb-1.5">หมู่</label>
          <input id="mrMoo" type="text" placeholder="ทุกหมู่" class="w-full h-11 px-3 rounded-xl border border-line outline-none focus:border-primary"></div>
      </div>
      <div class="flex gap-2 mt-3">
        <button onclick="loadMonthlyReport()" class="btn flex-1 h-11 rounded-xl bg-primary text-white font-500 flex items-center justify-center gap-2"><i data-lucide="search" class="w-5 h-5"></i> ดูรายงาน</button>
        <button onclick="exportMonthlyCSV()" class="btn h-11 px-4 rounded-xl bg-success/10 text-success font-500 flex items-center gap-2"><i data-lucide="file-down" class="w-5 h-5"></i> CSV</button>
        <button onclick="window.print()" class="btn h-11 px-4 rounded-xl bg-primary/10 text-primary font-500 flex items-center gap-2"><i data-lucide="printer" class="w-5 h-5"></i></button>
      </div>
    </div>
    <div id="mrResult"></div>`;
  refreshIcons();
  loadMonthlyReport();
}
async function loadMonthlyReport() {
  const data = { month: $id('mrMonth').value, year: $id('mrYear').value, moo: $id('mrMoo').value.trim() };
  if (isAdmin() && $id('mrCg')) data.caregiverCode = $id('mrCg').value;
  $id('mrResult').innerHTML = listSkeleton();
  const res = await api('getMonthlyReport', data, { loading: false });
  if (!res.success) { $id('mrResult').innerHTML = emptyState('โหลดรายงานไม่สำเร็จ'); refreshIcons(); return; }
  _monthlyData = res.data;
  renderMonthlyReport();
}
function renderMonthlyReport() {
  const d = _monthlyData;
  const acts = Object.keys(d.activityCounts || {}).map(k => ({ name: k, count: d.activityCounts[k] })).sort((a, b) => b.count - a.count);
  const maxCount = acts.length ? acts[0].count : 1;

  const summary = `<div class="bg-primary text-white rounded-2xl p-4 mb-3">
      <div class="text-sm text-white/80">รายงานเดือน ${THAI_MONTHS[d.month - 1]} ${d.yearTH}</div>
      <div class="grid grid-cols-2 gap-3 mt-2">
        <div><div class="text-3xl font-600 leading-none">${d.totalVisits}</div><div class="text-xs text-white/80 mt-1">ครั้งการเยี่ยมรวม</div></div>
        <div><div class="text-3xl font-600 leading-none">${d.patientsCovered}</div><div class="text-xs text-white/80 mt-1">ผู้ป่วยที่ดูแล</div></div>
      </div>
    </div>`;

  const actCard = `<div class="bg-card rounded-2xl shadow-card p-4 mb-3">
      <h3 class="font-600 text-ink mb-3 flex items-center gap-2"><i data-lucide="activity" class="w-5 h-5 text-primary"></i> จำนวนกิจกรรมแต่ละประเภท</h3>
      ${acts.length ? acts.map(a => `
        <div class="mb-2">
          <div class="flex justify-between text-sm mb-1"><span class="text-ink truncate pr-2">${esc(a.name)}</span><span class="text-muted shrink-0">${a.count}</span></div>
          <div class="h-2 bg-subtle rounded-full overflow-hidden"><div class="h-full bg-primary rounded-full" style="width:${Math.round(a.count / maxCount * 100)}%"></div></div>
        </div>`).join('') : '<div class="text-muted text-sm text-center py-4">ไม่มีข้อมูล</div>'}
    </div>`;

  const cgTable = `<div class="bg-card rounded-2xl shadow-card p-4 mb-3">
      <h3 class="font-600 text-ink mb-3 flex items-center gap-2"><i data-lucide="user-cog" class="w-5 h-5 text-primary"></i> แยกตาม Care Giver</h3>
      <table class="w-full text-sm"><thead><tr class="text-muted text-left border-b border-line">
        <th class="py-2 font-500">Care Giver</th><th class="py-2 font-500 text-center">ครั้ง</th><th class="py-2 font-500 text-center">ผู้ป่วย</th></tr></thead>
      <tbody>${(d.byCaregiver || []).length ? d.byCaregiver.map(c => `<tr class="border-b border-line">
        <td class="py-2">${esc(c.caregiverName || c.caregiverCode)}</td><td class="py-2 text-center">${c.visits}</td><td class="py-2 text-center">${c.patients}</td></tr>`).join('') : '<tr><td colspan="3" class="py-4 text-center text-muted">ไม่มีข้อมูล</td></tr>'}</tbody></table>
    </div>`;

  const ptTable = `<div class="bg-card rounded-2xl shadow-card p-4">
      <h3 class="font-600 text-ink mb-3 flex items-center gap-2"><i data-lucide="users" class="w-5 h-5 text-primary"></i> แยกตามผู้ป่วย</h3>
      <table class="w-full text-sm"><thead><tr class="text-muted text-left border-b border-line">
        <th class="py-2 font-500">ผู้ป่วย</th><th class="py-2 font-500 text-center">จำนวนครั้ง</th></tr></thead>
      <tbody>${(d.byPatient || []).length ? d.byPatient.sort((a, b) => b.visits - a.visits).map(p => `<tr class="border-b border-line">
        <td class="py-2">${esc(p.patientName)}</td><td class="py-2 text-center">${p.visits}</td></tr>`).join('') : '<tr><td colspan="2" class="py-4 text-center text-muted">ไม่มีข้อมูล</td></tr>'}</tbody></table>
    </div>`;

  $id('mrResult').innerHTML = summary + actCard + cgTable + ptTable;
  refreshIcons();
}
function exportMonthlyCSV() {
  if (!_monthlyData) return alertError('ไม่มีข้อมูลสำหรับ Export');
  const d = _monthlyData;
  const cols = [{ label: 'ผู้ป่วย', key: 'patientName' }, { label: 'จำนวนครั้งที่เยี่ยม', key: 'visits' }];
  exportCSV('รายงานรายเดือน_' + d.month + '-' + d.yearTH + '.csv', cols, d.byPatient || []);
}


// ===============================
// VIEW: ตั้งค่าระบบ (Admin)
// ===============================
async function viewSettings(container) {
  const u = getUser();
  const apiShown = (CONFIG.API_URL || '').replace(/^(https?:\/\/[^/]+).*(\/exec.*)$/, '$1/...$2');
  container.innerHTML = `
    <div class="bg-card rounded-2xl shadow-card p-5 mb-3">
      <h3 class="font-600 text-ink mb-3 flex items-center gap-2"><i data-lucide="plug-zap" class="w-5 h-5 text-primary"></i> การเชื่อมต่อระบบ</h3>
      <div class="text-sm space-y-1.5">
        <div class="flex justify-between gap-2"><span class="text-muted">ชื่อระบบ</span><span class="text-ink font-500 text-right">${esc(CONFIG.SYSTEM_NAME)}</span></div>
        <div class="flex justify-between gap-2"><span class="text-muted">API URL</span><span class="text-ink font-500 text-right break-all">${esc(apiShown || '-')}</span></div>
      </div>
      <button onclick="pingApi()" class="btn w-full h-11 rounded-xl bg-primary/10 text-primary font-500 mt-3 flex items-center justify-center gap-2"><i data-lucide="wifi" class="w-5 h-5"></i> ตรวจสอบการเชื่อมต่อ API</button>
      <div id="pingResult" class="text-center mt-2"></div>
    </div>

    <div class="bg-card rounded-2xl shadow-card p-5 mb-3">
      <h3 class="font-600 text-ink mb-1 flex items-center gap-2"><i data-lucide="database" class="w-5 h-5 text-warning"></i> ฐานข้อมูล (Google Sheets)</h3>
      <p class="text-sm text-muted mb-3">สร้าง/ตรวจสอบชีตทั้งหมดและบัญชีผู้ดูแลระบบเริ่มต้น (ไม่ลบข้อมูลเดิม)</p>
      <button onclick="runSetupSheets()" class="btn w-full h-11 rounded-xl bg-warning/10 text-warning font-500 flex items-center justify-center gap-2"><i data-lucide="wrench" class="w-5 h-5"></i> เรียก setupSheets()</button>
    </div>

    <div class="bg-card rounded-2xl shadow-card p-5 mb-3">
      <h3 class="font-600 text-ink mb-1 flex items-center gap-2"><i data-lucide="sliders-horizontal" class="w-5 h-5 text-primary"></i> ค่าระบบ (Setting)</h3>
      <p class="text-sm text-muted mb-3">แก้ไขค่าที่เก็บในชีต Setting เช่น Folder ID รูปภาพ, ชื่อระบบ, URL ของ Web App</p>
      <div id="settingList"><div class="text-sm text-muted">กำลังโหลด...</div></div>
      <button id="settingSaveBtn" onclick="saveSettings()" class="btn w-full h-11 rounded-xl bg-primary text-white font-500 mt-2 hidden items-center justify-center gap-2"><i data-lucide="save" class="w-5 h-5"></i> บันทึกค่าระบบ</button>
    </div>

    <div class="bg-card rounded-2xl shadow-card p-5 mb-3">
      <h3 class="font-600 text-ink mb-1 flex items-center gap-2"><i data-lucide="upload" class="w-5 h-5 text-primary"></i> นำเข้าข้อมูลจาก CSV</h3>
      <p class="text-sm text-muted mb-4">นำเข้าทีละหลายรายการจากไฟล์ CSV (แถวแรกต้องเป็นหัวตาราง) — ตรวจสอบความถูกต้องก่อนบันทึก</p>

      <div class="rounded-xl border border-line p-3 mb-3">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="font-500 text-ink flex items-center gap-2"><i data-lucide="users" class="w-4 h-4 text-primary"></i> ผู้มีภาวะพึ่งพิง (Patients)</span>
          <button onclick="downloadCsvTemplate('patients')" class="text-xs text-primary inline-flex items-center gap-1"><i data-lucide="file-down" class="w-3.5 h-3.5"></i> เทมเพลต</button>
        </div>
        <input id="ptCsvFile" type="file" accept=".csv,text/csv" class="block w-full text-sm text-muted file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:font-500 file:cursor-pointer mb-2">
        <button onclick="importCsv('patients')" class="btn w-full h-10 rounded-xl bg-primary text-white font-500 flex items-center justify-center gap-2"><i data-lucide="upload" class="w-4 h-4"></i> นำเข้าผู้ป่วย</button>
        <div id="ptCsvResult" class="mt-2"></div>
        <p class="text-[11px] text-muted mt-2 leading-relaxed">คอลัมน์: ชื่อ-สกุล, เลขบัตรประชาชน, วันเกิด, เพศ, บ้านเลขที่, หมู่, ผู้ดูแล, เบอร์โทรผู้ดูแล</p>
      </div>

      <div class="rounded-xl border border-line p-3">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="font-500 text-ink flex items-center gap-2"><i data-lucide="user-cog" class="w-4 h-4 text-primary"></i> Care Giver (CareGivers)</span>
          <button onclick="downloadCsvTemplate('caregivers')" class="text-xs text-primary inline-flex items-center gap-1"><i data-lucide="file-down" class="w-3.5 h-3.5"></i> เทมเพลต</button>
        </div>
        <input id="cgCsvFile" type="file" accept=".csv,text/csv" class="block w-full text-sm text-muted file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border-0 file:bg-primary/10 file:text-primary file:font-500 file:cursor-pointer mb-2">
        <button onclick="importCsv('caregivers')" class="btn w-full h-10 rounded-xl bg-primary text-white font-500 flex items-center justify-center gap-2"><i data-lucide="upload" class="w-4 h-4"></i> นำเข้า Care Giver</button>
        <div id="cgCsvResult" class="mt-2"></div>
        <p class="text-[11px] text-muted mt-2 leading-relaxed">คอลัมน์: ชื่อ-สกุล, เลขบัตรประชาชน, เบอร์โทร, บ้านเลขที่, หมู่, ชื่อผู้ใช้, รหัสผ่าน</p>
      </div>
    </div>

    <div class="bg-card rounded-2xl shadow-card p-5">
      <h3 class="font-600 text-ink mb-3 flex items-center gap-2"><i data-lucide="shield-check" class="w-5 h-5 text-success"></i> บัญชีผู้ดูแลระบบ</h3>
      <div class="text-sm space-y-1.5">
        <div class="flex justify-between gap-2"><span class="text-muted">ชื่อ</span><span class="text-ink font-500">${esc(u.fullName || '-')}</span></div>
        <div class="flex justify-between gap-2"><span class="text-muted">ชื่อผู้ใช้</span><span class="text-ink font-500">${esc(u.username)}</span></div>
        <div class="flex justify-between gap-2"><span class="text-muted">สิทธิ์</span><span class="text-ink font-500">${esc(u.role)}</span></div>
      </div>
    </div>`;
  refreshIcons();
  loadSettings();
}

let _settings = [];
async function loadSettings() {
  const res = await api('getSettings', {}, { loading: false, silent: true });
  if (!res.success) { $id('settingList').innerHTML = `<div class="text-sm text-danger">โหลดค่าระบบไม่สำเร็จ (${esc(res.message || '')})</div>`; return; }
  _settings = res.data || [];
  if (!_settings.length) { $id('settingList').innerHTML = '<div class="text-sm text-muted">ยังไม่มีค่าระบบ — กดปุ่ม setupSheets() เพื่อสร้างชีต Setting</div>'; return; }
  $id('settingList').innerHTML = _settings.map((s, i) => `
    <div class="mb-3">
      <label class="block text-sm font-500 text-ink mb-0.5">${esc(s.key)}</label>
      ${s.detail ? `<div class="text-xs text-muted mb-1.5">${esc(s.detail)}</div>` : '<div class="mb-1.5"></div>'}
      <input id="set_${i}" type="text" value="${esc(s.value)}" class="w-full h-11 px-3 rounded-xl border border-line bg-bg text-ink outline-none focus:border-primary">
    </div>`).join('');
  $id('settingSaveBtn').classList.remove('hidden');
  $id('settingSaveBtn').classList.add('flex');
  refreshIcons();
}
async function saveSettings() {
  const items = _settings.map((s, i) => ({ key: s.key, value: ($id('set_' + i) ? $id('set_' + i).value.trim() : s.value) }));
  const res = await api('updateSetting', { settings: items }, { loadingText: 'กำลังบันทึกค่าระบบ...' });
  if (res.success) {
    toast('บันทึกค่าระบบสำเร็จ');
    _settings = items.map((it, i) => ({ key: it.key, value: it.value, detail: _settings[i] ? _settings[i].detail : '' }));
    const an = items.find(it => it.key === 'APP_NAME');
    if (an) applyAppName(an.value);
  }
}
async function pingApi() {
  $id('pingResult').innerHTML = '<span class="text-muted text-sm">กำลังตรวจสอบ...</span>';
  try {
    const res = await fetch(CONFIG.API_URL + '?action=ping');
    const j = await res.json();
    $id('pingResult').innerHTML = j.success
      ? `<span class="text-success text-sm inline-flex items-center gap-1"><i data-lucide="check-circle-2" class="w-4 h-4"></i> เชื่อมต่อสำเร็จ</span>`
      : `<span class="text-danger text-sm">เชื่อมต่อไม่สำเร็จ</span>`;
  } catch (e) {
    $id('pingResult').innerHTML = `<span class="text-danger text-sm">เชื่อมต่อไม่ได้: ${esc(e.message)}</span>`;
  }
  refreshIcons();
}
async function runSetupSheets() {
  const ok = await confirmDialog({ title: 'เรียก setupSheets()?', text: 'จะสร้าง/ตรวจสอบชีตทั้งหมดและบัญชี admin เริ่มต้น (ข้อมูลเดิมไม่ถูกลบ)', confirmText: 'ดำเนินการ', icon: 'question' });
  if (!ok) return;
  const res = await api('setupSheets', {}, { loadingText: 'กำลังตั้งค่าชีต...' });
  if (res.success) alertSuccess('ตั้งค่าชีตเรียบร้อย: ' + ((res.data && res.data.sheets) || []).join(', '));
}


// ===============================
// CSV IMPORT (ผู้ป่วย / Care Giver)
// ===============================

/** parser CSV รองรับ field ที่มีเครื่องหมายคำพูด ลูกน้ำ และขึ้นบรรทัดใหม่ */
function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* ข้าม */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

const PT_HEADER_MAP = {
  'ชื่อ-สกุล': 'fullName', 'ชื่อ': 'fullName', 'ชื่อสกุล': 'fullName', 'fullname': 'fullName', 'name': 'fullName',
  'เลขบัตรประชาชน': 'pid', 'บัตรประชาชน': 'pid', 'เลขบัตร': 'pid', 'pid': 'pid',
  'วันเกิด': 'birthDate', 'birthdate': 'birthDate', 'dob': 'birthDate',
  'เพศ': 'gender', 'gender': 'gender',
  'บ้านเลขที่': 'houseNo', 'บ้าน': 'houseNo', 'houseno': 'houseNo',
  'หมู่': 'moo', 'moo': 'moo',
  'ผู้ดูแล': 'caregiverName', 'ชื่อผู้ดูแล': 'caregiverName', 'caregivername': 'caregiverName',
  'เบอร์โทรผู้ดูแล': 'caregiverPhone', 'caregiverphone': 'caregiverPhone'
};
const CG_HEADER_MAP = {
  'ชื่อ-สกุล': 'fullName', 'ชื่อ': 'fullName', 'ชื่อสกุล': 'fullName', 'fullname': 'fullName', 'name': 'fullName',
  'เลขบัตรประชาชน': 'pid', 'บัตรประชาชน': 'pid', 'เลขบัตร': 'pid', 'pid': 'pid',
  'เบอร์โทร': 'phone', 'โทรศัพท์': 'phone', 'phone': 'phone',
  'บ้านเลขที่': 'houseNo', 'บ้าน': 'houseNo', 'houseno': 'houseNo',
  'หมู่': 'moo', 'moo': 'moo',
  'ชื่อผู้ใช้': 'username', 'username': 'username', 'user': 'username',
  'รหัสผ่าน': 'password', 'password': 'password', 'pass': 'password'
};

function downloadCsvTemplate(kind) {
  if (kind === 'patients') {
    const cols = [
      { label: 'ชื่อ-สกุล', key: 'fullName' }, { label: 'เลขบัตรประชาชน', key: 'pid' },
      { label: 'วันเกิด', key: 'birthDate' }, { label: 'เพศ', key: 'gender' },
      { label: 'บ้านเลขที่', key: 'houseNo' }, { label: 'หมู่', key: 'moo' },
      { label: 'ผู้ดูแล', key: 'caregiverName' }, { label: 'เบอร์โทรผู้ดูแล', key: 'caregiverPhone' }
    ];
    const sample = [{ fullName: 'นายตัวอย่าง ใจดี', pid: '1000000000009', birthDate: '01/05/2500', gender: 'ชาย', houseNo: '99', moo: '4', caregiverName: 'นางสมศรี ใจดี', caregiverPhone: '0812345678' }];
    exportCSV('template_patients.csv', cols, sample);
  } else {
    const cols = [
      { label: 'ชื่อ-สกุล', key: 'fullName' }, { label: 'เลขบัตรประชาชน', key: 'pid' },
      { label: 'เบอร์โทร', key: 'phone' }, { label: 'บ้านเลขที่', key: 'houseNo' },
      { label: 'หมู่', key: 'moo' }, { label: 'ชื่อผู้ใช้', key: 'username' }, { label: 'รหัสผ่าน', key: 'password' }
    ];
    const sample = [{ fullName: 'นางสาวผู้ดูแล ตัวอย่าง', pid: '1000000000009', phone: '0898765432', houseNo: '12', moo: '3', username: 'cg_somsri', password: '123456' }];
    exportCSV('template_caregivers.csv', cols, sample);
  }
}

async function importCsv(kind) {
  const fileId = kind === 'patients' ? 'ptCsvFile' : 'cgCsvFile';
  const resId = kind === 'patients' ? 'ptCsvResult' : 'cgCsvResult';
  const fileEl = $id(fileId);
  const file = fileEl && fileEl.files && fileEl.files[0];
  if (!file) return alertError('กรุณาเลือกไฟล์ CSV ก่อน');

  let text;
  try { text = await file.text(); } catch (e) { return alertError('อ่านไฟล์ไม่สำเร็จ: ' + e.message); }
  const rows = parseCSV(text);
  if (rows.length < 2) return alertError('ไฟล์ว่างหรือไม่มีข้อมูล (ต้องมีหัวตาราง + ข้อมูลอย่างน้อย 1 แถว)');

  const map = kind === 'patients' ? PT_HEADER_MAP : CG_HEADER_MAP;
  const keys = rows[0].map(h => { const t = String(h).trim(); return map[t] || map[t.toLowerCase()] || null; });
  if (!keys.includes('fullName') || !keys.includes('pid')) {
    return alertError('ไม่พบคอลัมน์ที่จำเป็น (อย่างน้อยต้องมี "ชื่อ-สกุล" และ "เลขบัตรประชาชน") — ลองดาวน์โหลดเทมเพลตเพื่อดูรูปแบบ');
  }

  // แปลงเป็น object + ตรวจความถูกต้องฝั่ง client
  const valid = [], invalid = [];
  for (let r = 1; r < rows.length; r++) {
    const o = {};
    rows[r].forEach((cell, ci) => { const k = keys[ci]; if (k) o[k] = String(cell).trim(); });
    const errs = [];
    if (!o.fullName) errs.push('ไม่มีชื่อ-สกุล');
    if (!feValidatePid(o.pid)) errs.push('เลขบัตรประชาชนไม่ถูกต้อง');
    if (kind === 'caregivers') {
      if (!feValidatePhone(o.phone)) errs.push('เบอร์โทรไม่ถูกต้อง');
      if (!o.username) errs.push('ไม่มีชื่อผู้ใช้');
      if (!o.password || o.password.length < 6) errs.push('รหัสผ่านต้อง ≥ 6 ตัว');
    } else {
      if (o.caregiverPhone && !feValidatePhone(o.caregiverPhone)) errs.push('เบอร์ผู้ดูแลไม่ถูกต้อง');
    }
    if (errs.length) invalid.push({ line: r + 1, name: o.fullName || '(ไม่มีชื่อ)', errs });
    else valid.push(o);
  }

  if (!valid.length) { $id(resId).innerHTML = importSummaryHtml(0, [], invalid); refreshIcons(); return alertError('ไม่มีแถวที่ถูกต้องสำหรับนำเข้า'); }

  const ok = await confirmDialog({
    title: 'ยืนยันการนำเข้า?',
    text: `ข้อมูลถูกต้อง ${valid.length} แถว` + (invalid.length ? ` · ข้ามที่ไม่ถูกต้อง ${invalid.length} แถว` : '') + ' — เริ่มนำเข้าเลยหรือไม่?',
    confirmText: 'นำเข้า', icon: 'question'
  });
  if (!ok) return;

  const action = kind === 'patients' ? 'createPatient' : 'createCareGiver';
  let success = 0; const failed = [];
  for (let i = 0; i < valid.length; i++) {
    $id(resId).innerHTML = `<div class="flex items-center gap-2 text-sm text-muted"><span class="inline-block w-4 h-4 border-2 border-line border-t-primary rounded-full animate-spin"></span> กำลังนำเข้า ${i + 1}/${valid.length} ...</div>`;
    try {
      const res = await apiRaw(action, valid[i]);
      if (res && res.success) success++;
      else failed.push({ name: valid[i].fullName, msg: (res && res.message) || 'ไม่สำเร็จ' });
    } catch (e) {
      failed.push({ name: valid[i].fullName, msg: e.message });
    }
  }

  $id(resId).innerHTML = importSummaryHtml(success, failed, invalid);
  refreshIcons();
  if (success) toast(`นำเข้าสำเร็จ ${success} รายการ`);
}

function importSummaryHtml(success, failed, invalid) {
  failed = failed || []; invalid = invalid || [];
  let html = `<div class="rounded-xl bg-subtle p-3 text-sm space-y-1">
      <div class="flex items-center gap-2 text-success"><i data-lucide="check-circle-2" class="w-4 h-4"></i> นำเข้าสำเร็จ <span class="font-600">${success}</span> รายการ</div>`;
  if (failed.length) {
    html += `<div class="flex items-center gap-2 text-danger"><i data-lucide="x-circle" class="w-4 h-4"></i> ล้มเหลว ${failed.length} รายการ</div>
      <ul class="list-disc pl-5 text-xs text-muted">${failed.slice(0, 8).map(f => `<li>${esc(f.name)} — ${esc(f.msg)}</li>`).join('')}${failed.length > 8 ? `<li>…อีก ${failed.length - 8} รายการ</li>` : ''}</ul>`;
  }
  if (invalid.length) {
    html += `<div class="flex items-center gap-2 text-warning"><i data-lucide="alert-triangle" class="w-4 h-4"></i> ข้ามแถวที่ไม่ถูกต้อง ${invalid.length} แถว</div>
      <ul class="list-disc pl-5 text-xs text-muted">${invalid.slice(0, 8).map(v => `<li>แถว ${v.line} (${esc(v.name)}) — ${esc(v.errs.join(', '))}</li>`).join('')}${invalid.length > 8 ? `<li>…อีก ${invalid.length - 8} แถว</li>` : ''}</ul>`;
  }
  html += `</div>`;
  return html;
}


// ===============================
// BOOT
// ===============================

/** ใช้ชื่อระบบกับ title/หน้า login/sidebar (อิงค่า APP_NAME จากชีต Setting) */
function applyAppName(name) {
  name = (name && String(name).trim()) || CONFIG.SYSTEM_NAME;
  CONFIG.SYSTEM_NAME = name;
  document.title = name;
  document.querySelectorAll('[data-app-name]').forEach(function (el) { el.textContent = name; });
}
/** ดึง APP_NAME จาก ping (ไม่ต้องล็อกอิน) แล้วนำมาแสดง */
async function loadAppName() {
  try {
    const res = await fetch(CONFIG.API_URL + '?action=ping');
    const j = await res.json();
    applyAppName(j && j.success && j.data ? j.data.appName : '');
  } catch (e) {
    applyAppName('');
  }
}

function boot() {
  // ใช้ธีมที่บันทึกไว้ (หรือตามระบบ)
  const savedTheme = localStorage.getItem('care_theme') ||
    ((window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
  applyTheme(savedTheme);

  // ดึงชื่อระบบจาก APP_NAME (ไม่บล็อกการแสดงผล)
  loadAppName();

  refreshIcons();

  // ปุ่มแสดง/ซ่อนรหัสผ่าน
  $id('togglePw').addEventListener('click', () => {
    const inp = $id('loginPassword');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    refreshIcons();
  });
  $id('loginForm').addEventListener('submit', handleLogin);

  // มี session อยู่แล้ว → เข้าแอป
  loadSession();
  if (SESSION && SESSION.token) {
    renderApp();
  } else {
    renderLogin();
  }
}

window.addEventListener('DOMContentLoaded', boot);
