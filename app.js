// Global State and Constants
const KPI_CHEM = 1.12;
const KPI_ELEC = 1.42;
const KPI_TOTAL = 2.54;
const CONTRACT_YIELD = 97.0; // %

let allRecords = [];
let filteredRecords = [];
let charts = {};
let activeDayRecord = null;

// DOM Elements
const monthSelect = document.getElementById('month-select');
const viewModeContainer = document.getElementById('view-mode');
const chemTabsContainer = document.getElementById('chem-tabs');
const tableBody = document.getElementById('table-body');
const tableTitle = document.getElementById('table-title');
const btnExportCsv = document.getElementById('btn-export-csv');

// Chemical Mapping
const chemKeyMap = {
    alum: { name: 'Alum', qty: 'alum_qty', cost: 'alum_cost', color: '#cc66ff' },
    chlorine: { name: 'Chlorine', qty: 'chlorine_qty', cost: 'chlorine_cost', color: '#33ccff' },
    citric: { name: 'Citric Acid', qty: 'citric_qty', cost: 'citric_cost', color: '#ffcc00' },
    hcl: { name: 'HCl', qty: 'hcl_qty', cost: 'hcl_cost', color: '#ff5533' },
    naoh: { name: 'NaOH', qty: 'naoh_qty', cost: 'naoh_cost', color: '#00e676' }
};
let activeChem = 'alum';

const AUTH_HASH = "b3ae63623322432aec33906c5bfc62be924a9ad8ce6e24f844b92df7e8333070"; // SHA-256 for 'wangchan2026'

// Hash function helper using Web Crypto API
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    checkPasswordProtection();
});

function checkPasswordProtection() {
    const overlay = document.getElementById('password-overlay');
    const form = document.getElementById('password-form');
    const input = document.getElementById('password-input');
    const errorMsg = document.getElementById('password-error');

    // Check if already authorized
    if (localStorage.getItem('isWaterDashboardAuthorized') === 'true') {
        overlay.style.display = 'none';
        initDashboard();
        return;
    }

    // Handle login form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = input.value;
        const hashed = await sha256(pwd);

        if (hashed === AUTH_HASH) {
            localStorage.setItem('isWaterDashboardAuthorized', 'true');
            overlay.style.display = 'none';
            initDashboard();
        } else {
            errorMsg.style.display = 'block';
            input.value = '';
            input.focus();
        }
    });
}

function initDashboard() {
    fetchData();
    setupEventListeners();
}

// ===== Data Source: Google Sheets (Direct CSV) =====
const SHEET_ID   = "1TrzIgdqfWHTJpQWGnRiuujLyr_yNYxQA9oBriqOyM_k";
const SHEET_NAME = "Raw data";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

// Column indices (0-based) ตรงกับ Raw data sheet
const CI = {
    DATE:           0,   // A
    ALUM_QTY:       1,   // B
    ALUM_COST:      2,   // C
    CL_QTY:         3,   // D
    CL_COST:        4,   // E
    CITRIC_QTY:     5,   // F
    CITRIC_COST:    6,   // G
    HCL_QTY:        7,   // H
    HCL_COST:       8,   // I
    NAOH_QTY:       9,   // J
    NAOH_COST:      10,  // K
    CHEM_COST_M3:   12,  // M
    ELEC_COST_M3:   14,  // O
    TOTAL_COST_M3:  15,  // P
    WATER_QTY:      16,  // Q
    YIELD:          20,  // U
    ELEC1:          40,  // AO
    ELEC2:          42,  // AQ
};

// Simple CSV row parser (handles quoted fields)
function parseCSVRow(row) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    result.push(cur.trim());
    return result;
}

function parseNum(val) {
    if (val === null || val === undefined || val === '') return 0;
    const clean = String(val).replace(/,/g, '').replace(/%/g, '').trim();
    if (clean === '-' || clean === '') return 0;
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
}

function parseYield(val) {
    if (val === null || val === undefined || val === '') return null;
    const clean = String(val).replace(/,/g, '').replace(/%/g, '').trim();
    if (clean === '-' || clean === '' || clean === '0') return null;
    const n = parseFloat(clean);
    return isNaN(n) || n === 0 ? null : n;
}

function parseDate(val) {
    if (!val) return null;
    // M/D/YYYY
    const parts = val.split('/');
    if (parts.length === 3) {
        const m = String(parseInt(parts[0])).padStart(2, '0');
        const d = String(parseInt(parts[1])).padStart(2, '0');
        const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        return `${y}-${m}-${d}`;
    }
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    return null;
}

function csvToRecords(csvText) {
    const lines = csvText.split('\n').filter(l => l.trim() !== '');
    const records = [];
    for (let i = 0; i < lines.length; i++) {
        const cols = parseCSVRow(lines[i]);
        const rawDate = cols[CI.DATE];
        if (!rawDate || !/\d/.test(rawDate)) continue; // skip header/empty
        const dateStr = parseDate(rawDate);
        if (!dateStr) continue;

        records.push({
            date:           dateStr,
            water_qty:      parseNum(cols[CI.WATER_QTY]),
            system_yield:   parseYield(cols[CI.YIELD]),
            alum_qty:       parseNum(cols[CI.ALUM_QTY]),
            alum_cost:      parseNum(cols[CI.ALUM_COST]),
            chlorine_qty:   parseNum(cols[CI.CL_QTY]),
            chlorine_cost:  parseNum(cols[CI.CL_COST]),
            citric_qty:     parseNum(cols[CI.CITRIC_QTY]),
            citric_cost:    parseNum(cols[CI.CITRIC_COST]),
            hcl_qty:        parseNum(cols[CI.HCL_QTY]),
            hcl_cost:       parseNum(cols[CI.HCL_COST]),
            naoh_qty:       parseNum(cols[CI.NAOH_QTY]),
            naoh_cost:      parseNum(cols[CI.NAOH_COST]),
            chem_cost_m3:   parseNum(cols[CI.CHEM_COST_M3]),
            elec_qty:       parseNum(cols[CI.ELEC1]) + parseNum(cols[CI.ELEC2]),
            elec_cost_m3:   parseNum(cols[CI.ELEC_COST_M3]),
            total_cost_m3:  parseNum(cols[CI.TOTAL_COST_M3]),
        });
    }
    return records;
}

// Main data loader: Live Google Sheet → fallback data.js
async function fetchData() {
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="13" class="loading-text"><i class="fa-solid fa-spinner fa-spin"></i> กำลังดึงข้อมูลจาก Google Sheet...</td></tr>`;
    }

    // 1) ลองดึง Live CSV จาก Google Sheets
    try {
        const res = await fetch(SHEET_CSV_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const csvText = await res.text();
        const records = csvToRecords(csvText);
        if (records.length === 0) throw new Error('ไม่พบแถวข้อมูลใน Sheet');

        allRecords = records;
        allRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
        console.log(`✅ Live: โหลดข้อมูล ${allRecords.length} แถวจาก Google Sheet`);
        showDataSourceBadge('live');
        filterAndProcessData();
        return;
    } catch (err) {
        console.warn('⚠️ Google Sheet fetch ล้มเหลว (Sheet อาจไม่เป็น Public):', err.message);
    }

    // 2) Fallback → ใช้ data.js (ข้อมูล offline)
    try {
        if (typeof allRecordsData === 'undefined' || !Array.isArray(allRecordsData)) {
            throw new Error('ไม่พบข้อมูล — กรุณาตั้งค่า Sheet ให้เป็น Public หรือตรวจสอบ data.js');
        }
        allRecords = [...allRecordsData];
        allRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
        console.log(`📦 Offline: โหลดข้อมูล ${allRecords.length} แถวจาก data.js`);
        showDataSourceBadge('static');
        filterAndProcessData();
    } catch (error) {
        console.error('Error:', error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="13" class="loading-text" style="color:var(--color-kpi-fail);">
                <i class="fa-solid fa-triangle-exclamation"></i> โหลดข้อมูลไม่ได้: ${error.message}<br>
                <small>กรุณาตั้งค่า Google Sheet ให้เป็น "Anyone with link can view"</small>
            </td></tr>`;
        }
    }
}

// Badge บอกแหล่งข้อมูล (มุมขวาล่าง)
function showDataSourceBadge(mode) {
    const existing = document.getElementById('data-source-badge');
    if (existing) existing.remove();
    const badge = document.createElement('div');
    badge.id = 'data-source-badge';
    if (mode === 'live') {
        badge.innerHTML = `<i class="fa-solid fa-circle" style="color:#00e676;font-size:8px;animation:pulse 2s infinite;"></i>&nbsp; Live — Google Sheet`;
        badge.title = 'ข้อมูล Real-time จาก Google Sheets';
    } else {
        badge.innerHTML = `<i class="fa-solid fa-circle" style="color:#ffcc00;font-size:8px;"></i>&nbsp; Offline — data.js (Sheet ยังไม่ Public)`;
        badge.title = 'ใช้ข้อมูล Offline เพราะดึง Google Sheet ไม่ได้';
    }
    badge.style.cssText = `position:fixed;bottom:16px;right:16px;z-index:9999;
        background:rgba(10,13,20,0.88);backdrop-filter:blur(10px);
        border:1px solid rgba(255,255,255,0.1);border-radius:20px;
        padding:7px 16px;font-size:12px;color:var(--text-secondary);
        display:flex;align-items:center;gap:6px;
        font-family:'Outfit',sans-serif;font-weight:500;
        box-shadow:0 4px 16px rgba(0,0,0,0.4);`;
    document.body.appendChild(badge);
}

// Event Listeners Setup
function setupEventListeners() {
    // Month change — reset day selection and rebuild day picker
    monthSelect.addEventListener('change', () => {
        filterAndProcessData();
    });

    // View Mode (Daily, Weekly, Monthly) change
    viewModeContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.segment-btn');
        if (!btn) return;
        
        document.querySelectorAll('#view-mode .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        filterAndProcessData();
    });

    // Chemical Tabs change
    chemTabsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        
        document.querySelectorAll('#chem-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        activeChem = btn.dataset.chem;
        updateChemicalSection();
    });

    // Export CSV Button
    btnExportCsv.addEventListener('click', exportCSV);

    // Day Clear Button
    document.getElementById('day-clear-btn').addEventListener('click', () => {
        if (filteredRecords.length > 0) {
            activeDayRecord = filteredRecords[filteredRecords.length - 1];
        }
        renderDayPicker();
        updateKpiCards();
        highlightTableRow();
    });

    // Day Picker Dropdown — toggle open/close
    const trigger = document.getElementById('day-picker-trigger');
    const dropdown = document.getElementById('day-picker-dropdown');

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        if (isOpen) {
            closeDayDropdown();
        } else {
            dropdown.classList.add('open');
            trigger.classList.add('open');
        }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!document.getElementById('day-picker-trigger-wrap').contains(e.target)) {
            closeDayDropdown();
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDayDropdown();
    });
}

// Core Data Filter and Aggregator
function filterAndProcessData() {
    const selectedMonth = monthSelect.value;
    const viewMode = document.querySelector('#view-mode .segment-btn.active').dataset.mode;
    
    // 1. Filter raw records
    if (selectedMonth === 'all') {
        filteredRecords = [...allRecords];
        tableTitle.innerText = `ตารางบันทึกข้อมูลรายวัน (แสดงข้อมูลล่าสุด เดือนธันวาคม 2569)`;
    } else {
        filteredRecords = allRecords.filter(r => {
            const parts = r.date.split('-'); // YYYY-MM-DD
            return parts[1] === selectedMonth;
        });
        const monthNames = [
            'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
            'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
        ];
        tableTitle.innerText = `ตารางบันทึกข้อมูลรายวัน (เฉพาะเดือน${monthNames[parseInt(selectedMonth) - 1]} 2569)`;
    }

    // Set default active day (latest day in filtered records)
    if (filteredRecords.length > 0) {
        activeDayRecord = filteredRecords[filteredRecords.length - 1];
    } else {
        activeDayRecord = null;
    }

    // 2. Render Day Picker
    renderDayPicker();

    // 3. Update KPI Cards & Render Daily Table
    updateKpiCards();
    renderDailyTable();

    // 4. Render and Update Charts based on viewMode
    updateCharts(viewMode);
}

// ===== Day Picker =====
const monthNamesAll = [
    'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
];

function renderDayPicker() {
    const dayGrid = document.getElementById('day-grid');
    const clearBtn = document.getElementById('day-clear-btn');
    const triggerLabel = document.getElementById('day-picker-trigger-label');
    const monthLabel = document.getElementById('day-picker-month-label');
    const selectedMonth = monthSelect.value;

    // Update trigger button label with selected day
    if (activeDayRecord) {
        const dp = activeDayRecord.date.split('-');
        const d = parseInt(dp[2]);
        const mIdx = parseInt(dp[1]) - 1;
        const y = parseInt(dp[0]) + 543;
        triggerLabel.textContent = `${d} ${monthNamesAll[mIdx]} ${y}`;
    } else {
        triggerLabel.textContent = 'เลือกวันที่...';
    }

    // Show/hide clear button
    const isLatestDay = activeDayRecord && filteredRecords.length > 0 &&
        activeDayRecord.date === filteredRecords[filteredRecords.length - 1].date;
    clearBtn.style.display = (!isLatestDay && activeDayRecord) ? 'flex' : 'none';

    if (!filteredRecords || filteredRecords.length === 0) {
        dayGrid.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">ไม่มีข้อมูลในเดือนนี้</span>';
        return;
    }

    if (selectedMonth === 'all') {
        dayGrid.innerHTML = `<span style="color:var(--text-muted);font-size:13px;">
            <i class="fa-solid fa-info-circle"></i> กรุณาเลือกเดือนก่อน
        </span>`;
        monthLabel.textContent = 'เลือกเดือนก่อนเพื่อดูวัน';
        return;
    }

    // Build day map
    const dayMap = {};
    filteredRecords.forEach(r => {
        dayMap[parseInt(r.date.split('-')[2])] = r;
    });

    const firstDate = filteredRecords[0].date.split('-');
    const monthIdx = parseInt(firstDate[1]) - 1;
    const year = parseInt(firstDate[0]);
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

    // Dropdown header label
    monthLabel.textContent = `${monthNamesAll[monthIdx]} ${year + 543}`;

    // Build buttons
    let html = '';
    for (let d = 1; d <= daysInMonth; d++) {
        const rec = dayMap[d];
        const isActive = activeDayRecord && parseInt(activeDayRecord.date.split('-')[2]) === d;
        const dateStr = `${year}-${String(monthIdx + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

        let btnClass = 'day-btn';
        let titleAttr = `วันที่ ${d} — ไม่มีข้อมูล`;

        if (rec) {
            btnClass += ' has-data';
            const yVal = rec.system_yield;
            if (!yVal || yVal === 0) {
                btnClass += ' yield-na';
                titleAttr = `${d}/${monthIdx+1}/${year+543} | น้ำ: ${formatNum(rec.water_qty)} ลบ.ม. | Yield: N/A`;
            } else if (yVal >= CONTRACT_YIELD) {
                btnClass += ' yield-pass';
                titleAttr = `${d}/${monthIdx+1}/${year+543} | น้ำ: ${formatNum(rec.water_qty)} ลบ.ม. | Yield: ${formatNum(yVal,2)}% ✓`;
            } else {
                btnClass += ' yield-fail';
                titleAttr = `${d}/${monthIdx+1}/${year+543} | น้ำ: ${formatNum(rec.water_qty)} ลบ.ม. | Yield: ${formatNum(yVal,2)}% ✗`;
            }
        } else {
            btnClass += ' no-data';
        }
        if (isActive) btnClass += ' active';
        html += `<button class="${btnClass}" data-date="${dateStr}" title="${titleAttr}">${d}</button>`;
    }
    dayGrid.innerHTML = html;

    // Click listeners
    dayGrid.querySelectorAll('.day-btn:not(.no-data)').forEach(btn => {
        btn.addEventListener('click', () => {
            const rec = allRecords.find(r => r.date === btn.dataset.date);
            if (!rec) return;
            activeDayRecord = rec;

            dayGrid.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update trigger label
            const dp2 = rec.date.split('-');
            const dNum = parseInt(dp2[2]);
            const mIdx2 = parseInt(dp2[1]) - 1;
            const y2 = parseInt(dp2[0]) + 543;
            triggerLabel.textContent = `${dNum} ${monthNamesAll[mIdx2]} ${y2}`;

            // Show clear btn
            const isLast = activeDayRecord.date === filteredRecords[filteredRecords.length - 1].date;
            clearBtn.style.display = !isLast ? 'flex' : 'none';

            updateKpiCards();
            highlightTableRow();
            closeDayDropdown();
        });
    });
}

function closeDayDropdown() {
    const dropdown = document.getElementById('day-picker-dropdown');
    const trigger = document.getElementById('day-picker-trigger');
    dropdown.classList.remove('open');
    trigger.classList.remove('open');
}

// Highlight the active row in the daily table
function highlightTableRow() {
    if (!activeDayRecord) return;
    const rows = tableBody.querySelectorAll('tr');
    rows.forEach(row => {
        row.classList.remove('highlight-row');
        if (row.dataset.date === activeDayRecord.date) {
            row.classList.add('highlight-row');
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

// Calculate and Update KPI Card Metrics
function updateKpiCards() {
    if (!activeDayRecord) {
        clearKpiCards();
        return;
    }

    // A. Yearly calculation (always constant across the 2026 data set)
    const yearWaterAcc = allRecords.reduce((sum, r) => sum + r.water_qty, 0);
    const yearWaterAvg = yearWaterAcc / allRecords.length;
    
    const yearYieldRecords = allRecords.filter(r => r.system_yield !== null && r.system_yield > 0);
    const yearYieldAvg = yearYieldRecords.reduce((sum, r) => sum + r.system_yield, 0) / (yearYieldRecords.length || 1);
    
    const yearChemRecords = allRecords.filter(r => r.chem_cost_m3 > 0);
    const yearChemAvg = yearChemRecords.reduce((sum, r) => sum + r.chem_cost_m3, 0) / (yearChemRecords.length || 1);
    
    const yearElecRecords = allRecords.filter(r => r.elec_cost_m3 > 0);
    const yearElecAvg = yearElecRecords.reduce((sum, r) => sum + r.elec_cost_m3, 0) / (yearElecRecords.length || 1);
    
    const yearTotalRecords = allRecords.filter(r => r.total_cost_m3 > 0);
    const yearTotalAvg = yearTotalRecords.reduce((sum, r) => sum + r.total_cost_m3, 0) / (yearTotalRecords.length || 1);

    // B. Monthly calculation (based on the month of the active/selected day)
    const activeMonth = activeDayRecord.date.split('-')[1];
    const monthRecords = allRecords.filter(r => r.date.split('-')[1] === activeMonth);
    
    const monthWaterAcc = monthRecords.reduce((sum, r) => sum + r.water_qty, 0);
    const monthWaterAvg = monthWaterAcc / monthRecords.length;
    
    const monthYieldRecords = monthRecords.filter(r => r.system_yield !== null && r.system_yield > 0);
    const monthYieldAvg = monthYieldRecords.reduce((sum, r) => sum + r.system_yield, 0) / (monthYieldRecords.length || 1);
    
    const monthChemRecords = monthRecords.filter(r => r.chem_cost_m3 > 0);
    const monthChemAvg = monthChemRecords.reduce((sum, r) => sum + r.chem_cost_m3, 0) / (monthChemRecords.length || 1);
    
    const monthElecRecords = monthRecords.filter(r => r.elec_cost_m3 > 0);
    const monthElecAvg = monthElecRecords.reduce((sum, r) => sum + r.elec_cost_m3, 0) / (monthElecRecords.length || 1);
    
    const monthTotalRecords = monthRecords.filter(r => r.total_cost_m3 > 0);
    const monthTotalAvg = monthTotalRecords.reduce((sum, r) => sum + r.total_cost_m3, 0) / (monthTotalRecords.length || 1);

    // C. Update DOM
    // 1. Water Qty
    document.getElementById('water-daily').innerText = formatNum(activeDayRecord.water_qty);
    document.getElementById('water-month-acc').innerText = formatNum(monthWaterAcc) + ' ลบ.ม.';
    document.getElementById('water-month-avg').innerText = formatNum(monthWaterAvg, 1) + ' ลบ.ม./วัน';
    document.getElementById('water-year-acc').innerText = formatNum(yearWaterAcc) + ' ลบ.ม.';
    document.getElementById('water-year-avg').innerText = formatNum(yearWaterAvg, 1) + ' ลบ.ม./วัน';

    // 2. System Yield
    const yieldDaily = activeDayRecord.system_yield;
    const yieldDailyTxt = yieldDaily !== null ? formatNum(yieldDaily, 2) : '-';
    document.getElementById('yield-daily').innerText = yieldDailyTxt;
    document.getElementById('yield-month-avg').innerText = formatNum(monthYieldAvg, 2) + ' %';
    document.getElementById('yield-year-avg').innerText = formatNum(yearYieldAvg, 2) + ' %';
    
    // Check Yield KPI tag
    const yieldCard = document.getElementById('kpi-yield');
    if (yieldDaily !== null) {
        if (yieldDaily >= CONTRACT_YIELD) {
            yieldCard.querySelector('.kpi-target-tag').className = 'kpi-target-tag kpi-pass';
            yieldCard.querySelector('.kpi-target-tag').innerHTML = '<i class="fa-solid fa-check"></i> ได้ตามข้อกำหนดสัญญา (&ge; 97%)';
        } else {
            yieldCard.querySelector('.kpi-target-tag').className = 'kpi-target-tag kpi-fail';
            yieldCard.querySelector('.kpi-target-tag').innerHTML = '<i class="fa-solid fa-xmark"></i> ต่ำกว่าข้อกำหนดสัญญา (&lt; 97%)';
        }
    }

    // 3. Chemical Cost/m3
    document.getElementById('chem-cost-daily').innerText = formatNum(activeDayRecord.chem_cost_m3, 2);
    document.getElementById('chem-cost-month-avg').innerText = formatNum(monthChemAvg, 2) + ' บาท/ลบ.ม.';
    document.getElementById('chem-cost-year-avg').innerText = formatNum(yearChemAvg, 2) + ' บาท/ลบ.ม.';
    
    // Check Chem Cost KPI
    const chemTag = document.getElementById('kpi-tag-chem');
    if (activeDayRecord.chem_cost_m3 <= KPI_CHEM) {
        chemTag.className = 'kpi-target-tag kpi-pass';
        chemTag.innerHTML = `<i class="fa-solid fa-check"></i> ได้ตาม KPI (&le; ${KPI_CHEM})`;
    } else {
        chemTag.className = 'kpi-target-tag kpi-fail';
        chemTag.innerHTML = `<i class="fa-solid fa-xmark"></i> เกิน KPI (&gt; ${KPI_CHEM})`;
    }

    // 4. Electricity Cost/m3
    document.getElementById('elec-cost-daily').innerText = formatNum(activeDayRecord.elec_cost_m3, 2);
    document.getElementById('elec-cost-month-avg').innerText = formatNum(monthElecAvg, 2) + ' บาท/ลบ.ม.';
    document.getElementById('elec-cost-year-avg').innerText = formatNum(yearElecAvg, 2) + ' บาท/ลบ.ม.';
    
    // Check Elec Cost KPI
    const elecTag = document.getElementById('kpi-tag-elec');
    if (activeDayRecord.elec_cost_m3 <= KPI_ELEC) {
        elecTag.className = 'kpi-target-tag kpi-pass';
        elecTag.innerHTML = `<i class="fa-solid fa-check"></i> ได้ตาม KPI (&le; ${KPI_ELEC})`;
    } else {
        elecTag.className = 'kpi-target-tag kpi-fail';
        elecTag.innerHTML = `<i class="fa-solid fa-xmark"></i> เกิน KPI (&gt; ${KPI_ELEC})`;
    }

    // 5. Total Cost/m3
    document.getElementById('total-cost-daily').innerText = formatNum(activeDayRecord.total_cost_m3, 2);
    document.getElementById('total-cost-month-avg').innerText = formatNum(monthTotalAvg, 2) + ' บาท/ลบ.ม.';
    document.getElementById('total-cost-year-avg').innerText = formatNum(yearTotalAvg, 2) + ' บาท/ลบ.ม.';
    
    // Check Total Cost KPI
    const totalTag = document.getElementById('kpi-tag-total');
    if (activeDayRecord.total_cost_m3 <= KPI_TOTAL) {
        totalTag.className = 'kpi-target-tag kpi-pass';
        totalTag.innerHTML = `<i class="fa-solid fa-check"></i> ได้ตาม KPI (&le; ${KPI_TOTAL})`;
    } else {
        totalTag.className = 'kpi-target-tag kpi-fail';
        totalTag.innerHTML = `<i class="fa-solid fa-xmark"></i> เกิน KPI (&gt; ${KPI_TOTAL})`;
    }

    // Update chemical section stats
    updateChemicalSection();

    // Update Electricity Section stats
    document.getElementById('elec-usage-daily').innerText = formatNum(activeDayRecord.elec_qty, 1);
    const monthElecAcc = monthRecords.reduce((sum, r) => sum + r.elec_qty, 0);
    document.getElementById('elec-usage-month-acc').innerText = formatNum(monthElecAcc, 1) + ' kW';
}

// Clear KPI cards when no data
function clearKpiCards() {
    const ids = ['water-daily', 'water-month-acc', 'water-month-avg', 'water-year-acc', 'water-year-avg',
                 'yield-daily', 'yield-month-avg', 'yield-year-avg',
                 'chem-cost-daily', 'chem-cost-month-avg', 'chem-cost-year-avg',
                 'elec-cost-daily', 'elec-cost-month-avg', 'elec-cost-year-avg',
                 'total-cost-daily', 'total-cost-month-avg', 'total-cost-year-avg'];
    ids.forEach(id => {
        document.getElementById(id).innerText = '-';
    });
}

// Update Chemical tab content
function updateChemicalSection() {
    if (!activeDayRecord) return;
    
    const chemMeta = chemKeyMap[activeChem];
    const activeMonth = activeDayRecord.date.split('-')[1];
    const monthRecords = allRecords.filter(r => r.date.split('-')[1] === activeMonth);
    
    const dailyQty = activeDayRecord[chemMeta.qty];
    const dailyCost = activeDayRecord[chemMeta.cost];
    
    const monthQtyAcc = monthRecords.reduce((sum, r) => sum + r[chemMeta.qty], 0);
    const monthCostAcc = monthRecords.reduce((sum, r) => sum + r[chemMeta.cost], 0);
    
    document.getElementById('tab-chem-qty-daily').innerText = formatNum(dailyQty, 1);
    document.getElementById('tab-chem-qty-month-acc').innerText = formatNum(monthQtyAcc, 1) + ' kg';
    document.getElementById('tab-chem-cost-daily').innerText = formatNum(dailyCost, 1);
    document.getElementById('tab-chem-cost-month-acc').innerText = formatNum(monthCostAcc, 1) + ' บาท';

    // Rerender Chemical detail chart
    renderChemDetailChart();
}

// Render Daily Logs Table
function renderDailyTable() {
    // If month selector is 'all', show the latest month's daily logs (December) to prevent loading 365 rows in the DOM
    let tableRecords = [];
    const selectedMonth = monthSelect.value;
    
    if (selectedMonth === 'all') {
        tableRecords = allRecords.filter(r => r.date.split('-')[1] === '12');
    } else {
        tableRecords = [...filteredRecords];
    }
    
    if (tableRecords.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="13" class="loading-text">ไม่มีข้อมูลในตัวกรองนี้</td></tr>';
        return;
    }
    
    let html = '';
    tableRecords.forEach((r, idx) => {
        const isCurrent = activeDayRecord && r.date === activeDayRecord.date;
        const rowClass = isCurrent ? 'class="highlight-row"' : '';
        
        // Formatted yield
        const yieldVal = r.system_yield;
        let yieldClass = '';
        let yieldText = '-';
        if (yieldVal !== null) {
            yieldClass = yieldVal >= CONTRACT_YIELD ? 'class="yield-pass"' : 'class="yield-fail"';
            yieldText = formatNum(yieldVal, 1) + '%';
        }
        
        // Highlight costs exceeding KPIs
        const chemCostClass = r.chem_cost_m3 > KPI_CHEM ? 'style="color: var(--color-kpi-fail); font-weight:600;"' : '';
        const elecCostClass = r.elec_cost_m3 > KPI_ELEC ? 'style="color: var(--color-kpi-fail); font-weight:600;"' : '';
        const totalCostClass = r.total_cost_m3 > KPI_TOTAL ? 'style="color: var(--color-kpi-fail); font-weight:600;"' : '';

        // Formatted Date
        const dateParts = r.date.split('-');
        const dateThai = `${parseInt(dateParts[2])}/${parseInt(dateParts[1])}/${parseInt(dateParts[0]) + 43}`; // Convert to BE style 2569

        html += `
            <tr ${rowClass} data-date="${r.date}" style="cursor: pointer;">
                <td><strong>${dateThai}</strong></td>
                <td class="highlight-col">${formatNum(r.water_qty)}</td>
                <td ${yieldClass}>${yieldText}</td>
                <td>${formatNum(r.elec_qty, 1)}</td>
                <td>${formatNum(r.elec_qty * 4.0, 0)}</td> <!-- Electricity cost is qty * 4.0 -->
                <td ${chemCostClass}>${formatNum(r.chem_cost_m3, 2)}</td>
                <td ${elecCostClass}>${formatNum(r.elec_cost_m3, 2)}</td>
                <td ${totalCostClass}>${formatNum(r.total_cost_m3, 2)}</td>
                <td>${formatNum(r.alum_qty, 1)}</td>
                <td>${formatNum(r.chlorine_qty, 1)}</td>
                <td>${formatNum(r.citric_qty, 1)}</td>
                <td>${formatNum(r.hcl_qty, 1)}</td>
                <td>${formatNum(r.naoh_qty, 1)}</td>
            </tr>
        `;
    });
    
    tableBody.innerHTML = html;

    // Add click listener to rows for interactive KPI updates
    const rows = tableBody.querySelectorAll('tr');
    rows.forEach(row => {
        row.addEventListener('click', () => {
            const date = row.dataset.date;
            activeDayRecord = allRecords.find(r => r.date === date);
            
            // Highlight selected row
            rows.forEach(r => r.removeAttribute('class'));
            row.setAttribute('class', 'highlight-row');
            
            // Highlight row logic styling
            row.style.backgroundColor = 'rgba(0, 210, 255, 0.08)';
            
            updateKpiCards();
        });
    });
}

// Chart Render Controllers
function updateCharts(viewMode) {
    let dataset = [];
    
    // Aggregate data if Weekly or Monthly is selected
    if (viewMode === 'daily') {
        dataset = [...filteredRecords];
    } else if (viewMode === 'weekly') {
        dataset = aggregateWeekly(filteredRecords);
    } else if (viewMode === 'monthly') {
        dataset = aggregateMonthly(filteredRecords);
    }

    renderYieldProductionChart(dataset, viewMode);
    renderCostsKpiChart(dataset, viewMode);
    renderElectricityChart(dataset, viewMode);
    renderChemDetailChart(); // Uses its own filtered set based on active chemical
}

// Aggregate Data by Week
function aggregateWeekly(records) {
    // Group records by week number
    const weeks = {};
    records.forEach(r => {
        const d = new Date(r.date);
        // Simple week number calculation
        const oneJan = new Date(d.getFullYear(), 0, 1);
        const numberOfDays = Math.floor((d - oneJan) / (24 * 60 * 60 * 1000));
        const weekNum = Math.ceil((numberOfDays + oneJan.getDay() + 1) / 7);
        
        if (!weeks[weekNum]) {
            weeks[weekNum] = {
                label: `สัปดาห์ที่ ${weekNum}`,
                water_qty: 0,
                system_yields: [],
                chem_costs: [],
                elec_costs: [],
                total_costs: [],
                elec_qty: 0
            };
        }
        
        weeks[weekNum].water_qty += r.water_qty;
        weeks[weekNum].elec_qty += r.elec_qty;
        
        if (r.system_yield !== null && r.system_yield > 0) weeks[weekNum].system_yields.push(r.system_yield);
        if (r.chem_cost_m3 > 0) weeks[weekNum].chem_costs.push(r.chem_cost_m3);
        if (r.elec_cost_m3 > 0) weeks[weekNum].elec_costs.push(r.elec_cost_m3);
        if (r.total_cost_m3 > 0) weeks[weekNum].total_costs.push(r.total_cost_m3);
    });

    return Object.keys(weeks).map(k => {
        const w = weeks[k];
        return {
            date: w.label,
            water_qty: w.water_qty,
            system_yield: w.system_yields.length > 0 ? (w.system_yields.reduce((s, x) => s + x, 0) / w.system_yields.length) : null,
            chem_cost_m3: w.chem_costs.length > 0 ? (w.chem_costs.reduce((s, x) => s + x, 0) / w.chem_costs.length) : 0,
            elec_cost_m3: w.elec_costs.length > 0 ? (w.elec_costs.reduce((s, x) => s + x, 0) / w.elec_costs.length) : 0,
            total_cost_m3: w.total_costs.length > 0 ? (w.total_costs.reduce((s, x) => s + x, 0) / w.total_costs.length) : 0,
            elec_qty: w.elec_qty
        };
    });
}

// Aggregate Data by Month
function aggregateMonthly(records) {
    const months = {};
    const monthNames = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    records.forEach(r => {
        const mIndex = parseInt(r.date.split('-')[1]) - 1;
        const mName = monthNames[mIndex];
        
        if (!months[mName]) {
            months[mName] = {
                label: mName,
                water_qty: 0,
                system_yields: [],
                chem_costs: [],
                elec_costs: [],
                total_costs: [],
                elec_qty: 0
            };
        }
        
        months[mName].water_qty += r.water_qty;
        months[mName].elec_qty += r.elec_qty;
        
        if (r.system_yield !== null && r.system_yield > 0) months[mName].system_yields.push(r.system_yield);
        if (r.chem_cost_m3 > 0) months[mName].chem_costs.push(r.chem_cost_m3);
        if (r.elec_cost_m3 > 0) months[mName].elec_costs.push(r.elec_cost_m3);
        if (r.total_cost_m3 > 0) months[mName].total_costs.push(r.total_cost_m3);
    });

    return Object.keys(months).map(k => {
        const m = months[k];
        return {
            date: m.label,
            water_qty: m.water_qty,
            system_yield: m.system_yields.length > 0 ? (m.system_yields.reduce((s, x) => s + x, 0) / m.system_yields.length) : null,
            chem_cost_m3: m.chem_costs.length > 0 ? (m.chem_costs.reduce((s, x) => s + x, 0) / m.chem_costs.length) : 0,
            elec_cost_m3: m.elec_costs.length > 0 ? (m.elec_costs.reduce((s, x) => s + x, 0) / m.elec_costs.length) : 0,
            total_cost_m3: m.total_costs.length > 0 ? (m.total_costs.reduce((s, x) => s + x, 0) / m.total_costs.length) : 0,
            elec_qty: m.elec_qty
        };
    });
}

// Format date label for Chart X-axis
function formatDateLabel(dateStr, viewMode) {
    if (viewMode !== 'daily') return dateStr;
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return `${parseInt(parts[2])}/${parseInt(parts[1])}`; // DD/MM format
}

// Chart 1: Yield and Production Trend Chart (Dual Axis)
function renderYieldProductionChart(dataset, viewMode) {
    const ctx = document.getElementById('yieldProductionChart').getContext('2d');
    
    const labels = dataset.map(d => formatDateLabel(d.date, viewMode));
    const waterData = dataset.map(d => d.water_qty);
    const yieldData = dataset.map(d => d.system_yield);

    if (charts.yieldProd) {
        charts.yieldProd.destroy();
    }

    charts.yieldProd = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'ปริมาณน้ำจ่าย (ลบ.ม.)',
                    data: waterData,
                    backgroundColor: 'rgba(0, 210, 255, 0.25)',
                    borderColor: 'rgba(0, 210, 255, 0.8)',
                    borderWidth: 1.5,
                    borderRadius: 4,
                    yAxisID: 'yWater',
                    order: 2
                },
                {
                    label: 'System Yield (%)',
                    data: yieldData,
                    type: 'line',
                    borderColor: '#00e676',
                    backgroundColor: 'rgba(0, 230, 118, 0.1)',
                    borderWidth: 2.5,
                    pointBackgroundColor: '#00e676',
                    pointHoverRadius: 6,
                    tension: 0.35,
                    yAxisID: 'yYield',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#94a3b8', font: { family: 'Sarabun' } }
                },
                tooltip: {
                    titleFont: { family: 'Sarabun' },
                    bodyFont: { family: 'Sarabun' },
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.datasetIndex === 0) {
                                label += formatNum(context.parsed.y) + ' ลบ.ม.';
                            } else {
                                label += formatNum(context.parsed.y, 2) + '%';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.02)' },
                    ticks: { color: '#64748b', font: { family: 'Outfit', size: 10 } }
                },
                yWater: {
                    type: 'linear',
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } },
                    title: { display: true, text: 'ปริมาณน้ำจ่าย (ลบ.ม.)', color: '#94a3b8', font: { family: 'Sarabun' } }
                },
                yYield: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    min: 70,
                    max: 120,
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } },
                    title: { display: true, text: 'System Yield (%)', color: '#94a3b8', font: { family: 'Sarabun' } }
                }
            }
        }
    });
}

// Chart 2: Costs comparison against KPI Limits
function renderCostsKpiChart(dataset, viewMode) {
    const ctx = document.getElementById('costsKpiChart').getContext('2d');
    
    const labels = dataset.map(d => formatDateLabel(d.date, viewMode));
    const chemData = dataset.map(d => d.chem_cost_m3);
    const elecData = dataset.map(d => d.elec_cost_m3);
    const totalData = dataset.map(d => d.total_cost_m3);

    if (charts.costsKpi) {
        charts.costsKpi.destroy();
    }

    charts.costsKpi = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'ต้นทุนรวม (บาท/ลบ.ม.)',
                    data: totalData,
                    borderColor: 'rgba(255, 85, 51, 1)',
                    backgroundColor: 'rgba(255, 85, 51, 0.05)',
                    borderWidth: 2,
                    pointRadius: 1,
                    tension: 0.2
                },
                {
                    label: 'ต้นทุนสารเคมี (บาท/ลบ.ม.)',
                    data: chemData,
                    borderColor: 'rgba(204, 102, 255, 0.8)',
                    borderWidth: 1.5,
                    pointRadius: 0.5,
                    tension: 0.2
                },
                {
                    label: 'ต้นทุนไฟฟ้า (บาท/ลบ.ม.)',
                    data: elecData,
                    borderColor: 'rgba(255, 204, 0, 0.8)',
                    borderWidth: 1.5,
                    pointRadius: 0.5,
                    tension: 0.2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#94a3b8', font: { family: 'Sarabun', size: 11 } }
                },
                tooltip: {
                    titleFont: { family: 'Sarabun' },
                    bodyFont: { family: 'Sarabun' }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.02)' },
                    ticks: { color: '#64748b', font: { family: 'Outfit', size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } },
                    title: { display: true, text: 'ต้นทุน (บาท ต่อ ลบ.ม.)', color: '#94a3b8', font: { family: 'Sarabun' } }
                }
            }
        }
    });
}

// Chart 3: Chemical Tab usages and costs
function renderChemDetailChart() {
    const ctx = document.getElementById('chemDetailChart').getContext('2d');
    const chemMeta = chemKeyMap[activeChem];
    
    const labels = filteredRecords.map(r => {
        const parts = r.date.split('-');
        return `${parseInt(parts[2])}/${parseInt(parts[1])}`;
    });
    const qtyData = filteredRecords.map(r => r[chemMeta.qty]);
    const costData = filteredRecords.map(r => r[chemMeta.cost]);

    if (charts.chemDetail) {
        charts.chemDetail.destroy();
    }

    charts.chemDetail = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `ปริมาณการใช้ ${chemMeta.name} (kg)`,
                    data: qtyData,
                    backgroundColor: chemMeta.color + '40', // 25% opacity
                    borderColor: chemMeta.color,
                    borderWidth: 1.5,
                    borderRadius: 4,
                    yAxisID: 'yQty'
                },
                {
                    label: `ต้นทุนสารเคมี ${chemMeta.name} (บาท)`,
                    data: costData,
                    type: 'line',
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.1)',
                    borderWidth: 2,
                    pointRadius: 2,
                    yAxisID: 'yCost'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#94a3b8', font: { family: 'Sarabun', size: 11 } }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.02)' },
                    ticks: { color: '#64748b', font: { family: 'Outfit', size: 10 } }
                },
                yQty: {
                    type: 'linear',
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } },
                    title: { display: true, text: 'ปริมาณใช้งาน (kg)', color: '#94a3b8', font: { family: 'Sarabun' } }
                },
                yCost: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } },
                    title: { display: true, text: 'ต้นทุน (บาท)', color: '#94a3b8', font: { family: 'Sarabun' } }
                }
            }
        }
    });
}

// Chart 4: Electricity Consumption Chart
function renderElectricityChart(dataset, viewMode) {
    const ctx = document.getElementById('electricityChart').getContext('2d');
    
    const labels = dataset.map(d => formatDateLabel(d.date, viewMode));
    const elecData = dataset.map(d => d.elec_qty);

    if (charts.elecChart) {
        charts.elecChart.destroy();
    }

    charts.elecChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'การใช้ไฟฟ้า (kW)',
                    data: elecData,
                    backgroundColor: 'rgba(255, 204, 0, 0.2)',
                    borderColor: '#ffcc00',
                    borderWidth: 1.5,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.02)' },
                    ticks: { color: '#64748b', font: { family: 'Outfit', size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', font: { family: 'Outfit' } },
                    title: { display: true, text: 'หน่วยไฟฟ้า (kW)', color: '#94a3b8', font: { family: 'Sarabun' } }
                }
            }
        }
    });
}

// Helper Utilities
function formatNum(num, decimals = 0) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return Number(num).toLocaleString('th-TH', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

// Export CSV Functionality
function exportCSV() {
    const selectedMonth = monthSelect.value;
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = selectedMonth === 'all' ? 'FullYear' : monthNames[parseInt(selectedMonth) - 1];
    
    // Prepare CSV header
    const headers = [
        'Date', 'Water_Qty_m3', 'System_Yield_Percent', 'Elec_Qty_kW', 'Elec_Cost_Baht', 
        'Chem_Cost_per_m3', 'Elec_Cost_per_m3', 'Total_Cost_per_m3',
        'Alum_Qty_kg', 'Chlorine_Qty_kg', 'Citric_Qty_kg', 'HCl_Qty_kg', 'NaOH_Qty_kg'
    ];
    
    let csvRows = [headers.join(',')];
    
    const recordsToExport = selectedMonth === 'all' ? allRecords : filteredRecords;
    
    recordsToExport.forEach(r => {
        const row = [
            r.date,
            r.water_qty,
            r.system_yield !== null ? r.system_yield : '',
            r.elec_qty,
            r.elec_qty * 4.0,
            r.chem_cost_m3,
            r.elec_cost_m3,
            r.total_cost_m3,
            r.alum_qty,
            r.chlorine_qty,
            r.citric_qty,
            r.hcl_qty,
            r.naoh_qty
        ];
        csvRows.push(row.join(','));
    });
    
    const csvContent = "\uFEFF" + csvRows.join('\n'); // Add UTF-8 BOM for Excel Thai language support
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Wangchan_Water_Report_${monthName}_2569.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
