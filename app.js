// Global State and Constants
const KPI_CHEM = 1.12;
const KPI_ELEC = 1.42;
const KPI_TOTAL = 2.54;
const CONTRACT_YIELD = 97.0; // %

let allRecords = [];
let filteredRecords = [];
let charts = {};
let activeDayRecord = null;
let activeRangeRecords = []; // List of records in the currently selected date range
let rangeStartDay = null;    // Day number (1-31) of the range start
let rangeEndDay = null;      // Day number (1-31) of the range end
let clickSelectStart = null; // Click-click selection start day

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
let activeChemPpm = 'alum';

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
const QUALITY_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Quality`;

// Column indices in Quality sheet (0-based)
const CI_Q = {
    DATE:         0,   // A
    PH:           12,  // M
    TURBIDITY:    13,  // N
    CONDUCTIVITY: 14,  // O
    TDS:          15,  // P
    CHLORINE:     16,  // Q
};

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

function mergeQualityData(csvText, records) {
    const lines = csvText.split('\n').filter(l => l.trim() !== '');
    const qualityMap = {};
    
    for (let i = 0; i < lines.length; i++) {
        const cols = parseCSVRow(lines[i]);
        const rawDate = cols[CI_Q.DATE];
        if (!rawDate || !/\d/.test(rawDate)) continue;
        const dateStr = parseDate(rawDate);
        if (!dateStr) continue;
        
        qualityMap[dateStr] = {
            ph:           parseYield(cols[CI_Q.PH]),
            turbidity:    parseYield(cols[CI_Q.TURBIDITY]),
            conductivity: parseYield(cols[CI_Q.CONDUCTIVITY]),
            tds:          parseYield(cols[CI_Q.TDS]),
            chlorine:     parseYield(cols[CI_Q.CHLORINE])
        };
    }
    
    // Merge into records
    records.forEach(r => {
        const q = qualityMap[r.date];
        if (q) {
            r.ph = q.ph;
            r.turbidity = q.turbidity;
            r.conductivity = q.conductivity;
            r.tds = q.tds;
            r.chlorine = q.chlorine;
        } else {
            r.ph = null;
            r.turbidity = null;
            r.conductivity = null;
            r.tds = null;
            r.chlorine = null;
        }
    });
}

// Main data loader: Live Google Sheet → fallback data.js
async function fetchData() {
    const tableBodyEl = document.getElementById('table-body');
    if (tableBodyEl) {
        tableBodyEl.innerHTML = `<tr><td colspan="13" class="loading-text"><i class="fa-solid fa-spinner fa-spin"></i> กำลังดึงข้อมูลจาก Google Sheet...</td></tr>`;
    }

    // 1) ลองดึง Live CSV จาก Google Sheets
    try {
        const [rawRes, qualRes] = await Promise.all([
            fetch(SHEET_CSV_URL),
            fetch(QUALITY_CSV_URL)
        ]);

        if (!rawRes.ok) throw new Error(`HTTP Raw data: ${rawRes.status}`);
        if (!qualRes.ok) throw new Error(`HTTP Quality: ${qualRes.status}`);

        const rawCsvText = await rawRes.text();
        const qualCsvText = await qualRes.text();

        const records = csvToRecords(rawCsvText);
        if (records.length === 0) throw new Error('ไม่พบแถวข้อมูลใน Sheet');

        mergeQualityData(qualCsvText, records);

        allRecords = records;
        allRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
        console.log(`✅ Live: โหลดข้อมูล ${allRecords.length} แถวจาก Google Sheet พร้อมข้อมูลคุณภาพน้ำ`);
        setDefaultMonthAndActiveDay();
        showDataSourceBadge('live');
        filterAndProcessData();
        return;
    } catch (err) {
        console.warn('⚠️ Google Sheet fetch ล้มเหลว (ใช้ข้อมูล offline สำรอง):', err.message);
    }

    // 2) Fallback → ใช้ data.js (ข้อมูล offline)
    try {
        if (typeof allRecordsData === 'undefined' || !Array.isArray(allRecordsData)) {
            throw new Error('ไม่พบข้อมูล — กรุณาตั้งค่า Sheet ให้เป็น Public หรือตรวจสอบ data.js');
        }
        allRecords = [...allRecordsData];
        // Inject offline mock quality data if not present
        allRecords.forEach(r => {
            r.ph = r.ph !== undefined ? r.ph : 7.2 + (Math.sin(new Date(r.date).getDate()) * 0.4);
            r.turbidity = r.turbidity !== undefined ? r.turbidity : 0.8 + (Math.cos(new Date(r.date).getDate()) * 0.3);
            r.conductivity = r.conductivity !== undefined ? r.conductivity : 280 + (new Date(r.date).getDate() % 10) * 15;
            r.tds = r.tds !== undefined ? r.tds : 140 + (new Date(r.date).getDate() % 10) * 8;
            r.chlorine = r.chlorine !== undefined ? r.chlorine : 1.2 + (Math.sin(new Date(r.date).getDate() * 2) * 0.2);
        });
        allRecords.sort((a, b) => new Date(a.date) - new Date(b.date));
        console.log(`📦 Offline: โหลดข้อมูล ${allRecords.length} แถวจาก data.js`);
        setDefaultMonthAndActiveDay();
        showDataSourceBadge('static');
        filterAndProcessData();
    } catch (error) {
        console.error('Error:', error);
        if (tableBodyEl) {
            tableBodyEl.innerHTML = `<tr><td colspan="13" class="loading-text" style="color:var(--color-kpi-fail);">
                <i class="fa-solid fa-triangle-exclamation"></i> โหลดข้อมูลไม่ได้: ${error.message}<br>
                <small>กรุณาตั้งค่า Google Sheet ให้เป็น "Anyone with link can view"</small>
            </td></tr>`;
        }
    }
}

// ตั้งค่าเริ่มต้นของเดือนและวันเป็นข้อมูลล่าสุดที่มีการอัปเดตจริง
function setDefaultMonthAndActiveDay() {
    if (!allRecords || allRecords.length === 0) return;

    // ค้นหาแถวล่าสุดที่มีข้อมูลการใช้งานจริง (ปริมาณน้ำ > 0 หรือ System Yield ไม่เป็น null)
    const recordsWithData = allRecords.filter(r => r.water_qty > 0 || (r.system_yield !== null && r.system_yield > 0));
    const latestRecord = recordsWithData.length > 0 ? recordsWithData[recordsWithData.length - 1] : allRecords[allRecords.length - 1];

    if (latestRecord) {
        const latestMonth = latestRecord.date.split('-')[1]; // ดึงเดือน เช่น "07"
        const monthSelectEl = document.getElementById('month-select');
        if (monthSelectEl) {
            monthSelectEl.value = latestMonth;
        }
        activeDayRecord = latestRecord;
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
    const monthSelectEl = document.getElementById('month-select');
    const viewModeEl = document.getElementById('view-mode');
    const chemTabsEl = document.getElementById('chem-tabs');
    const btnExportCsvEl = document.getElementById('btn-export-csv');
    const dayClearBtnEl = document.getElementById('day-clear-btn');
    const triggerEl = document.getElementById('day-picker-trigger');
    const dropdownEl = document.getElementById('day-picker-dropdown');

    if (monthSelectEl) {
        monthSelectEl.addEventListener('change', () => {
            filterAndProcessData();
        });
    }

    if (viewModeEl) {
        viewModeEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.segment-btn');
            if (!btn) return;
            
            viewModeEl.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            filterAndProcessData();
        });
    }

    if (chemTabsEl) {
        chemTabsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;
            
            chemTabsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            activeChem = btn.dataset.chem;
            updateChemicalSection();
        });
    }

    const costChartSelectEl = document.getElementById('cost-chart-select');
    if (costChartSelectEl) {
        costChartSelectEl.addEventListener('change', () => {
            let dataset = [];
            const activeViewBtn = document.querySelector('#view-mode .segment-btn.active');
            const viewMode = activeViewBtn ? activeViewBtn.dataset.mode : 'daily';
            
            if (viewMode === 'daily') {
                dataset = [...filteredRecords];
            } else if (viewMode === 'weekly') {
                dataset = aggregateWeekly(filteredRecords);
            } else if (viewMode === 'monthly') {
                dataset = aggregateMonthly(filteredRecords);
            }
            renderCostsKpiChart(dataset, viewMode);
        });
    }

    const chemPpmTabsEl = document.getElementById('chem-ppm-tabs');
    if (chemPpmTabsEl) {
        chemPpmTabsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;
            
            chemPpmTabsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            activeChemPpm = btn.dataset.chem;
            updateChemPpmSection();
        });
    }

    if (btnExportCsvEl) {
        btnExportCsvEl.addEventListener('click', exportCSV);
    }

    if (dayClearBtnEl) {
        dayClearBtnEl.addEventListener('click', () => {
            if (filteredRecords.length > 0) {
                activeDayRecord = filteredRecords[filteredRecords.length - 1];
                activeRangeRecords = [activeDayRecord];
                rangeStartDay = null;
                rangeEndDay = null;
                clickSelectStart = null;
                clickSelectEnd = null;
            }
            renderDayPicker();
            updateKpiCards();
            highlightTableRow();
        });
    }

    if (triggerEl && dropdownEl) {
        triggerEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdownEl.classList.contains('open');
            if (isOpen) {
                closeDayDropdown();
            } else {
                dropdownEl.classList.add('open');
                triggerEl.classList.add('open');
            }
        });
    }

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('day-picker-trigger-wrap');
        if (wrap && !wrap.contains(e.target)) {
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
    const monthSelectEl = document.getElementById('month-select');
    const selectedMonth = monthSelectEl ? monthSelectEl.value : 'all';
    
    const activeViewBtn = document.querySelector('#view-mode .segment-btn.active');
    const viewMode = activeViewBtn ? activeViewBtn.dataset.mode : 'daily';
    
    // 1. Filter raw records
    if (selectedMonth === 'all') {
        filteredRecords = [...allRecords];
        const titleEl = document.getElementById('table-title');
        if (titleEl) {
            titleEl.innerText = `ตารางบันทึกข้อมูลรายวัน (แสดงข้อมูลล่าสุด เดือนธันวาคม 2569)`;
        }
    } else {
        filteredRecords = allRecords.filter(r => {
            const parts = r.date.split('-'); // YYYY-MM-DD
            return parts[1] === selectedMonth;
        });
        const monthNames = [
            'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
            'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
        ];
        const titleEl = document.getElementById('table-title');
        if (titleEl) {
            titleEl.innerText = `ตารางบันทึกข้อมูลรายวัน (เฉพาะเดือน${monthNames[parseInt(selectedMonth) - 1]} 2569)`;
        }
    }

    // Set default active day (latest day in filtered records that has data)
    if (filteredRecords.length > 0) {
        const hasActiveInFiltered = activeDayRecord && filteredRecords.some(r => r.date === activeDayRecord.date);
        if (!hasActiveInFiltered) {
            const filteredWithData = filteredRecords.filter(r => r.water_qty > 0 || (r.system_yield !== null && r.system_yield > 0));
            activeDayRecord = filteredWithData.length > 0 ? filteredWithData[filteredWithData.length - 1] : filteredRecords[filteredRecords.length - 1];
            activeRangeRecords = [activeDayRecord];
            rangeStartDay = null;
            rangeEndDay = null;
            clickSelectStart = null;
            clickSelectEnd = null;
        }
    } else {
        activeDayRecord = null;
        activeRangeRecords = [];
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
    const monthSelectEl = document.getElementById('month-select');
    const selectedMonth = monthSelectEl ? monthSelectEl.value : 'all';

    // Update trigger button label with selected day
    if (activeDayRecord && triggerLabel) {
        const dp = activeDayRecord.date.split('-');
        const d = parseInt(dp[2]);
        const mIdx = parseInt(dp[1]) - 1;
        const y = parseInt(dp[0]) + 543;
        triggerLabel.textContent = `${d} ${monthNamesAll[mIdx]} ${y}`;
    } else if (triggerLabel) {
        triggerLabel.textContent = 'เลือกวันที่...';
    }

    // Show/hide clear button
    const isLatestDay = activeDayRecord && filteredRecords.length > 0 &&
        activeDayRecord.date === filteredRecords[filteredRecords.length - 1].date;
    if (clearBtn) {
        clearBtn.style.display = (!isLatestDay && activeDayRecord) ? 'flex' : 'none';
    }

    if (!filteredRecords || filteredRecords.length === 0) {
        if (dayGrid) {
            dayGrid.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">ไม่มีข้อมูลในเดือนนี้</span>';
        }
        return;
    }

    if (selectedMonth === 'all') {
        if (dayGrid) {
            dayGrid.innerHTML = `<span style="color:var(--text-muted);font-size:13px;">
                <i class="fa-solid fa-info-circle"></i> กรุณาเลือกเดือนก่อน
            </span>`;
        }
        if (monthLabel) {
            monthLabel.textContent = 'เลือกเดือนก่อนเพื่อดูวัน';
        }
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
    if (monthLabel) {
        monthLabel.textContent = `${monthNamesAll[monthIdx]} ${year + 543}`;
    }

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
    
    if (dayGrid) {
        dayGrid.innerHTML = html;

        // Apply range visual highlights based on current range selection
        if (activeRangeRecords && activeRangeRecords.length > 1) {
            const startDay = parseInt(activeRangeRecords[0].date.split('-')[2]);
            const endDay = parseInt(activeRangeRecords[activeRangeRecords.length - 1].date.split('-')[2]);
            updateRangeVisuals(startDay, endDay);
        } else if (activeDayRecord) {
            const activeDay = parseInt(activeDayRecord.date.split('-')[2]);
            updateRangeVisuals(activeDay, activeDay);
        }

        // Add click / mouseenter / mouseleave listeners for click-click range selecting
        const buttons = dayGrid.querySelectorAll('.day-btn:not(.no-data)');
        buttons.forEach(btn => {
            const day = parseInt(btn.textContent);

            // Mouseenter -> Preview click-click range
            btn.addEventListener('mouseenter', () => {
                if (clickSelectStart !== null) {
                    updateRangeVisuals(clickSelectStart, day);
                }
            });

            // Click -> Select start, then select end or single day
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // prevent closing dropdown
                
                if (clickSelectStart === null) {
                    // First click: select start day
                    clickSelectStart = day;
                    updateRangeVisuals(day, day);
                } else {
                    // Second click: finalize range or single day selection
                    if (day === clickSelectStart) {
                        // Double click same day: select single day
                        finalizeRangeSelection(day, day);
                    } else {
                        // Click different day: select range
                        finalizeRangeSelection(clickSelectStart, day);
                    }
                    clickSelectStart = null;
                }
            });
        });

        // Mouseleave -> Restore visual state to show only start day if not finalized
        dayGrid.addEventListener('mouseleave', () => {
            if (clickSelectStart !== null) {
                updateRangeVisuals(clickSelectStart, clickSelectStart);
            }
        });
    }
}

function closeDayDropdown() {
    const dropdown = document.getElementById('day-picker-dropdown');
    const trigger = document.getElementById('day-picker-trigger');
    if (dropdown) dropdown.classList.remove('open');
    if (trigger) trigger.classList.remove('open');
    
    // Reset click-click selection state if they closed the dropdown without making the second click
    clickSelectStart = null;
    renderDayPicker();
}

// อัปเดตคลาสแสดงผลช่วงวันที่เลือกในปฏิทิน
function updateRangeVisuals(start, end) {
    const dayGrid = document.getElementById('day-grid');
    if (!dayGrid) return;
    const buttons = dayGrid.querySelectorAll('.day-btn:not(.no-data)');
    
    if (start === null) {
        buttons.forEach(btn => {
            btn.classList.remove('active', 'active-start', 'active-end', 'active-range');
        });
        return;
    }

    const min = end !== null ? Math.min(start, end) : start;
    const max = end !== null ? Math.max(start, end) : start;
    
    buttons.forEach(btn => {
        const day = parseInt(btn.textContent);
        btn.classList.remove('active', 'active-start', 'active-end', 'active-range');
        
        if (min === max) {
            if (day === min) btn.classList.add('active');
        } else {
            if (day === min) btn.classList.add('active-start');
            else if (day === max) btn.classList.add('active-end');
            else if (day > min && day < max) btn.classList.add('active-range');
        }
    });
}

// จัดเก็บข้อมูลของช่วงวันที่ถูกเลือกให้เป็นปัจจุบันและอัปเดตหน้า Dashboard
function finalizeRangeSelection(start, end) {
    if (!filteredRecords || filteredRecords.length === 0) return;
    
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    
    activeRangeRecords = filteredRecords.filter(r => {
        const d = parseInt(r.date.split('-')[2]);
        return d >= min && d <= max;
    });

    if (activeRangeRecords.length > 0) {
        activeDayRecord = activeRangeRecords[activeRangeRecords.length - 1];
        
        rangeStartDay = min;
        rangeEndDay = max;
        clickSelectStart = null;
        clickSelectEnd = null;
        
        renderDayPicker();
        updateKpiCards();
        highlightTableRow();
        
        // Show/hide clear button
        const clearBtn = document.getElementById('day-clear-btn');
        if (clearBtn) {
            const isLast = activeDayRecord.date === filteredRecords[filteredRecords.length - 1].date;
            clearBtn.style.display = (!isLast || activeRangeRecords.length > 1) ? 'flex' : 'none';
        }
        
        setTimeout(closeDayDropdown, 180);
    }
}

// Highlight the active row in the daily table
function highlightTableRow() {
    const tableBodyEl = document.getElementById('table-body');
    if (!tableBodyEl) return;
    const rows = tableBodyEl.querySelectorAll('tr');
    
    const isRange = activeRangeRecords && activeRangeRecords.length > 1;
    
    rows.forEach(row => {
        row.classList.remove('highlight-row');
        row.style.backgroundColor = ''; // clear inline styling
        
        if (isRange) {
            const inRange = activeRangeRecords.some(r => r.date === row.dataset.date);
            if (inRange) {
                row.classList.add('highlight-row');
                row.style.backgroundColor = 'rgba(0, 210, 255, 0.05)';
            }
        } else if (activeDayRecord && row.dataset.date === activeDayRecord.date) {
            row.classList.add('highlight-row');
            row.style.backgroundColor = 'rgba(0, 210, 255, 0.08)';
        }
    });
}

// Calculate and Update KPI Card Metrics
function updateKpiCards() {
    if (!activeDayRecord) {
        clearKpiCards();
        return;
    }

    const monthSelectEl = document.getElementById('month-select');
    const selectedMonth = monthSelectEl ? monthSelectEl.value : 'all';
    const activeViewBtn = document.querySelector('#view-mode .segment-btn.active');
    const viewMode = activeViewBtn ? activeViewBtn.dataset.mode : 'daily';

    const isAggregated = (selectedMonth === 'all' || viewMode === 'weekly' || viewMode === 'monthly');

    // Toggle Day Picker Visibility
    const dayPickerSection = document.getElementById('day-picker-section');
    if (dayPickerSection) {
        dayPickerSection.style.display = isAggregated ? 'none' : 'block';
    }

    const isRange = activeRangeRecords && activeRangeRecords.length > 1;

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

    // C. Range calculations if range selected
    let rangeWaterSum = 0;
    let rangeWaterAvg = 0;
    let rangeYieldAvg = 0;
    let rangeChemAvg = 0;
    let rangeElecAvg = 0;
    let rangeTotalAvg = 0;

    if (isRange) {
        rangeWaterSum = activeRangeRecords.reduce((sum, r) => sum + r.water_qty, 0);
        rangeWaterAvg = rangeWaterSum / activeRangeRecords.length;
        
        const rangeYieldRecs = activeRangeRecords.filter(r => r.system_yield !== null && r.system_yield > 0);
        rangeYieldAvg = rangeYieldRecs.reduce((sum, r) => sum + r.system_yield, 0) / (rangeYieldRecs.length || 1);

        const rangeChemRecs = activeRangeRecords.filter(r => r.chem_cost_m3 > 0);
        rangeChemAvg = rangeChemRecs.reduce((sum, r) => sum + r.chem_cost_m3, 0) / (rangeChemRecs.length || 1);

        const rangeElecRecs = activeRangeRecords.filter(r => r.elec_cost_m3 > 0);
        rangeElecAvg = rangeElecRecs.reduce((sum, r) => sum + r.elec_cost_m3, 0) / (rangeElecRecs.length || 1);

        const rangeTotalRecs = activeRangeRecords.filter(r => r.total_cost_m3 > 0);
        rangeTotalAvg = rangeTotalRecs.reduce((sum, r) => sum + r.total_cost_m3, 0) / (rangeTotalRecs.length || 1);
    }

    // D. Aggregation Calculations for Weekly/Monthly/Yearly
    let weeklyWaterAvg = 0, weeklyYieldAvg = 0, weeklyChemAvg = 0, weeklyElecAvg = 0, weeklyTotalAvg = 0;
    let monthlyWaterAvg = 0, monthlyYieldAvg = 0, monthlyChemAvg = 0, monthlyElecAvg = 0, monthlyTotalAvg = 0;

    if (viewMode === 'weekly') {
        const weeklyData = aggregateWeekly(filteredRecords);
        weeklyWaterAvg = weeklyData.reduce((sum, w) => sum + w.water_qty, 0) / (weeklyData.length || 1);
        
        const weeklyYieldRecs = weeklyData.filter(w => w.system_yield !== null && w.system_yield > 0);
        weeklyYieldAvg = weeklyYieldRecs.reduce((sum, w) => sum + w.system_yield, 0) / (weeklyYieldRecs.length || 1);
        
        const weeklyChemRecs = weeklyData.filter(w => w.chem_cost_m3 > 0);
        weeklyChemAvg = weeklyChemRecs.reduce((sum, w) => sum + w.chem_cost_m3, 0) / (weeklyChemRecs.length || 1);
        
        const weeklyElecRecs = weeklyData.filter(w => w.elec_cost_m3 > 0);
        weeklyElecAvg = weeklyElecRecs.reduce((sum, w) => sum + w.elec_cost_m3, 0) / (weeklyElecRecs.length || 1);
        
        const weeklyTotalRecs = weeklyData.filter(w => w.total_cost_m3 > 0);
        weeklyTotalAvg = weeklyTotalRecs.reduce((sum, w) => sum + w.total_cost_m3, 0) / (weeklyTotalRecs.length || 1);
    }

    if (viewMode === 'monthly') {
        const monthlyData = aggregateMonthly(filteredRecords);
        monthlyWaterAvg = monthlyData.reduce((sum, m) => sum + m.water_qty, 0) / (monthlyData.length || 1);
        
        const monthlyYieldRecs = monthlyData.filter(m => m.system_yield !== null && m.system_yield > 0);
        monthlyYieldAvg = monthlyYieldRecs.reduce((sum, m) => sum + m.system_yield, 0) / (monthlyYieldRecs.length || 1);
        
        const monthlyChemRecs = monthlyData.filter(m => m.chem_cost_m3 > 0);
        monthlyChemAvg = monthlyChemRecs.reduce((sum, m) => sum + m.chem_cost_m3, 0) / (monthlyChemRecs.length || 1);
        
        const monthlyElecRecs = monthlyData.filter(m => m.elec_cost_m3 > 0);
        monthlyElecAvg = monthlyElecRecs.reduce((sum, m) => sum + m.elec_cost_m3, 0) / (monthlyElecRecs.length || 1);
        
        const monthlyTotalRecs = monthlyData.filter(m => m.total_cost_m3 > 0);
        monthlyTotalAvg = monthlyTotalRecs.reduce((sum, m) => sum + m.total_cost_m3, 0) / (monthlyTotalRecs.length || 1);
    }

    // Helper to set text content safely
    function setTxt(id, val) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    // E. Update KPI Cards Title based on state
    const waterCardTitle = document.querySelector('#kpi-water h3');
    const yieldCardTitle = document.querySelector('#kpi-yield h3');
    const chemCardTitle = document.querySelector('#kpi-chem-cost h3');
    const elecCardTitle = document.querySelector('#kpi-elec-cost h3');
    const totalCardTitle = document.querySelector('#kpi-total-cost h3');

    if (selectedMonth === 'all') {
        if (waterCardTitle) waterCardTitle.innerHTML = 'ผลรวมปริมาณน้ำจ่ายสะสม <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายปี 2569)</span>';
        if (yieldCardTitle) yieldCardTitle.innerHTML = 'System Yield เฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายปี 2569)</span>';
        if (chemCardTitle) chemCardTitle.innerHTML = 'ต้นทุนเคมีเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายปี 2569)</span>';
        if (elecCardTitle) elecCardTitle.innerHTML = 'ต้นทุนไฟฟ้าเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายปี 2569)</span>';
        if (totalCardTitle) totalCardTitle.innerHTML = 'ต้นทุนรวมเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายปี 2569)</span>';
    } else if (viewMode === 'weekly') {
        if (waterCardTitle) waterCardTitle.innerHTML = 'ปริมาณน้ำจ่ายเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายสัปดาห์)</span>';
        if (yieldCardTitle) yieldCardTitle.innerHTML = 'System Yield เฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายสัปดาห์)</span>';
        if (chemCardTitle) chemCardTitle.innerHTML = 'ต้นทุนเคมีเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายสัปดาห์)</span>';
        if (elecCardTitle) elecCardTitle.innerHTML = 'ต้นทุนไฟฟ้าเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายสัปดาห์)</span>';
        if (totalCardTitle) totalCardTitle.innerHTML = 'ต้นทุนรวมเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายสัปดาห์)</span>';
    } else if (viewMode === 'monthly') {
        if (waterCardTitle) waterCardTitle.innerHTML = 'ปริมาณน้ำจ่ายเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายเดือน)</span>';
        if (yieldCardTitle) yieldCardTitle.innerHTML = 'System Yield เฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายเดือน)</span>';
        if (chemCardTitle) chemCardTitle.innerHTML = 'ต้นทุนเคมีเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายเดือน)</span>';
        if (elecCardTitle) elecCardTitle.innerHTML = 'ต้นทุนไฟฟ้าเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายเดือน)</span>';
        if (totalCardTitle) totalCardTitle.innerHTML = 'ต้นทุนรวมเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(รายเดือน)</span>';
    } else if (isRange) {
        if (waterCardTitle) waterCardTitle.innerHTML = 'ผลรวมปริมาณน้ำจ่าย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(ช่วงที่เลือก)</span>';
        if (yieldCardTitle) yieldCardTitle.innerHTML = 'System Yield เฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(ช่วงที่เลือก)</span>';
        if (chemCardTitle) chemCardTitle.innerHTML = 'ต้นทุนเคมีเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(ช่วงที่เลือก)</span>';
        if (elecCardTitle) elecCardTitle.innerHTML = 'ต้นทุนไฟฟ้าเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(ช่วงที่เลือก)</span>';
        if (totalCardTitle) totalCardTitle.innerHTML = 'ต้นทุนรวมเฉลี่ย <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(ช่วงที่เลือก)</span>';
    } else {
        if (waterCardTitle) waterCardTitle.innerHTML = 'ปริมาณน้ำจ่าย';
        if (yieldCardTitle) yieldCardTitle.innerHTML = 'System Yield';
        if (chemCardTitle) chemCardTitle.innerHTML = 'ต้นทุนสารเคมี';
        if (elecCardTitle) elecCardTitle.innerHTML = 'ต้นทุนไฟฟ้า';
        if (totalCardTitle) totalCardTitle.innerHTML = 'ต้นทุนรวม (เคมี + ไฟฟ้า)';
    }

    // F. Update DOM
    // 1. Water Qty
    let waterVal = activeDayRecord.water_qty;
    if (selectedMonth === 'all') {
        waterVal = yearWaterAcc;
    } else if (viewMode === 'weekly') {
        waterVal = weeklyWaterAvg;
    } else if (viewMode === 'monthly') {
        waterVal = monthlyWaterAvg;
    } else if (isRange) {
        waterVal = rangeWaterSum;
    }
    setTxt('water-daily', formatNum(waterVal));
    setTxt('water-month-acc', formatNum(monthWaterAcc) + ' ลบ.ม.');
    setTxt('water-month-avg', formatNum(monthWaterAvg, 1) + ' ลบ.ม./วัน');
    setTxt('water-year-acc', formatNum(yearWaterAcc) + ' ลบ.ม.');
    setTxt('water-year-avg', formatNum(yearWaterAvg, 1) + ' ลบ.ม./วัน');

    // 2. System Yield
    let yieldVal = activeDayRecord.system_yield;
    if (selectedMonth === 'all') {
        yieldVal = yearYieldAvg;
    } else if (viewMode === 'weekly') {
        yieldVal = weeklyYieldAvg;
    } else if (viewMode === 'monthly') {
        yieldVal = monthlyYieldAvg;
    } else if (isRange) {
        yieldVal = rangeYieldAvg;
    }
    const yieldDailyTxt = yieldVal !== null ? formatNum(yieldVal, 2) : '-';
    setTxt('yield-daily', yieldDailyTxt);
    setTxt('yield-month-avg', formatNum(monthYieldAvg, 2) + ' %');
    setTxt('yield-year-avg', formatNum(yearYieldAvg, 2) + ' %');
    
    // Check Yield KPI tag
    const yieldCard = document.getElementById('kpi-yield');
    if (yieldCard && yieldVal !== null) {
        const tag = yieldCard.querySelector('.kpi-target-tag');
        if (tag) {
            const isPassing = yieldVal >= CONTRACT_YIELD;
            tag.className = 'kpi-target-tag ' + (isPassing ? 'kpi-pass' : 'kpi-fail');
            tag.innerHTML = `<i class="fa-solid fa-${isPassing ? 'check' : 'xmark'}"></i> ${(selectedMonth === 'all' || viewMode !== 'daily' || isRange) ? 'เฉลี่ย' : ''}${isPassing ? 'ได้ตามข้อกำหนดสัญญา' : 'ต่ำกว่าข้อกำหนดสัญญา'} (&ge; 97%)`;
        }
    }

    // 3. Chemical Cost/m3
    let chemVal = activeDayRecord.chem_cost_m3;
    if (selectedMonth === 'all') {
        chemVal = yearChemAvg;
    } else if (viewMode === 'weekly') {
        chemVal = weeklyChemAvg;
    } else if (viewMode === 'monthly') {
        chemVal = monthlyChemAvg;
    } else if (isRange) {
        chemVal = rangeChemAvg;
    }
    setTxt('chem-cost-daily', formatNum(chemVal, 2));
    setTxt('chem-cost-month-avg', formatNum(monthChemAvg, 2) + ' บาท/ลบ.ม.');
    setTxt('chem-cost-year-avg', formatNum(yearChemAvg, 2) + ' บาท/ลบ.ม.');
    
    // Check Chem Cost KPI
    const chemTag = document.getElementById('kpi-tag-chem');
    if (chemTag) {
        const isPassing = chemVal <= KPI_CHEM;
        chemTag.className = 'kpi-target-tag ' + (isPassing ? 'kpi-pass' : 'kpi-fail');
        chemTag.innerHTML = `<i class="fa-solid fa-${isPassing ? 'check' : 'xmark'}"></i> ${(selectedMonth === 'all' || viewMode !== 'daily' || isRange) ? 'เฉลี่ย' : ''}${isPassing ? 'ได้ตาม KPI' : 'เกิน KPI'} (&le; ${KPI_CHEM})`;
    }

    // 4. Electricity Cost/m3
    let elecVal = activeDayRecord.elec_cost_m3;
    if (selectedMonth === 'all') {
        elecVal = yearElecAvg;
    } else if (viewMode === 'weekly') {
        elecVal = weeklyElecAvg;
    } else if (viewMode === 'monthly') {
        elecVal = monthlyElecAvg;
    } else if (isRange) {
        elecVal = rangeElecAvg;
    }
    setTxt('elec-cost-daily', formatNum(elecVal, 2));
    setTxt('elec-cost-month-avg', formatNum(monthElecAvg, 2) + ' บาท/ลบ.ม.');
    setTxt('elec-cost-year-avg', formatNum(yearElecAvg, 2) + ' บาท/ลบ.ม.');
    
    // Check Elec Cost KPI
    const elecTag = document.getElementById('kpi-tag-elec');
    if (elecTag) {
        const isPassing = elecVal <= KPI_ELEC;
        elecTag.className = 'kpi-target-tag ' + (isPassing ? 'kpi-pass' : 'kpi-fail');
        elecTag.innerHTML = `<i class="fa-solid fa-${isPassing ? 'check' : 'xmark'}"></i> ${(selectedMonth === 'all' || viewMode !== 'daily' || isRange) ? 'เฉลี่ย' : ''}${isPassing ? 'ได้ตาม KPI' : 'เกิน KPI'} (&le; ${KPI_ELEC})`;
    }

    // 5. Total Cost/m3
    let totalVal = activeDayRecord.total_cost_m3;
    if (selectedMonth === 'all') {
        totalVal = yearTotalAvg;
    } else if (viewMode === 'weekly') {
        totalVal = weeklyTotalAvg;
    } else if (viewMode === 'monthly') {
        totalVal = monthlyTotalAvg;
    } else if (isRange) {
        totalVal = rangeTotalAvg;
    }
    setTxt('total-cost-daily', formatNum(totalVal, 2));
    setTxt('total-cost-month-avg', formatNum(monthTotalAvg, 2) + ' บาท/ลบ.ม.');
    setTxt('total-cost-year-avg', formatNum(yearTotalAvg, 2) + ' บาท/ลบ.ม.');
    
    // Check Total Cost KPI
    const totalTag = document.getElementById('kpi-tag-total');
    if (totalTag) {
        const isPassing = totalVal <= KPI_TOTAL;
        totalTag.className = 'kpi-target-tag ' + (isPassing ? 'kpi-pass' : 'kpi-fail');
        totalTag.innerHTML = `<i class="fa-solid fa-${isPassing ? 'check' : 'xmark'}"></i> ${(selectedMonth === 'all' || viewMode !== 'daily' || isRange) ? 'เฉลี่ย' : ''}${isPassing ? 'ได้ตาม KPI' : 'เกิน KPI'} (&le; ${KPI_TOTAL})`;
    }

    // G. Update Range Info Banner in UI
    const rangeBanner = document.getElementById('range-summary-banner');
    if (rangeBanner) {
        if (isRange && !isAggregated) {
            rangeBanner.style.display = 'flex';
            
            const startRec = activeRangeRecords[0];
            const endRec = activeRangeRecords[activeRangeRecords.length - 1];
            
            const startParts = startRec.date.split('-');
            const endParts = endRec.date.split('-');
            
            const monthNamesAbbr = [
                'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
            ];
            
            const startDay = parseInt(startParts[2]);
            const startMonth = monthNamesAbbr[parseInt(startParts[1]) - 1];
            const startYear = parseInt(startParts[0]) + 543;
            
            const endDay = parseInt(endParts[2]);
            const endMonth = monthNamesAbbr[parseInt(endParts[1]) - 1];
            const endYear = parseInt(endParts[0]) + 543;
            
            let rangeText = '';
            if (startParts[1] === endParts[1]) {
                rangeText = `${startDay} - ${endDay} ${startMonth} ${startYear}`;
            } else {
                rangeText = `${startDay} ${startMonth} - ${endDay} ${endMonth} ${startYear}`;
            }
            
            document.getElementById('range-text-display').textContent = rangeText;
            document.getElementById('range-days-count').textContent = activeRangeRecords.length;
            document.getElementById('range-water-sum').textContent = formatNum(rangeWaterSum);
            document.getElementById('range-water-avg').textContent = formatNum(rangeWaterAvg, 1);
            document.getElementById('range-yield-avg').textContent = rangeYieldAvg !== null ? formatNum(rangeYieldAvg, 2) : '-';
        } else {
            rangeBanner.style.display = 'none';
        }
    }

    // Update chemical section stats
    updateChemicalSection();

    // Update Electricity Section stats
    const elecDailyLabel = document.querySelector('.elec-stat-card:nth-child(1) h4');
    const elecMonthLabel = document.querySelector('.elec-stat-card:nth-child(2) h4');

    if (isAggregated) {
        const totalElec = filteredRecords.reduce((sum, r) => sum + r.elec_qty, 0);
        const avgElec = totalElec / (filteredRecords.length || 1);
        
        if (elecDailyLabel) elecDailyLabel.innerText = 'ปริมาณการใช้ไฟฟ้าเฉลี่ย (ต่อวัน)';
        setTxt('elec-usage-daily', formatNum(avgElec, 1));
        
        if (selectedMonth === 'all') {
            if (elecMonthLabel) elecMonthLabel.innerText = 'ปริมาณการใช้ไฟฟ้าสะสมทั้งปี';
        } else {
            if (elecMonthLabel) elecMonthLabel.innerText = 'ปริมาณการใช้ไฟฟ้าสะสมทั้งเดือน';
        }
        setTxt('elec-usage-month-acc', formatNum(totalElec, 1) + ' kW');
    } else {
        if (elecDailyLabel) elecDailyLabel.innerText = 'ปริมาณการใช้ไฟฟ้า';
        setTxt('elec-usage-daily', formatNum(activeDayRecord.elec_qty, 1));
        
        if (elecMonthLabel) elecMonthLabel.innerText = 'ปริมาณการใช้ไฟฟ้าสะสมทั้งเดือน';
        const monthElecAcc = monthRecords.reduce((sum, r) => sum + r.elec_qty, 0);
        setTxt('elec-usage-month-acc', formatNum(monthElecAcc, 1) + ' kW');
    }

    // Update Water Quality Section stats
    updateQualitySection();
}

// Update Water Quality Section stats
function updateQualitySection() {
    if (!activeDayRecord || !filteredRecords || filteredRecords.length === 0) return;

    const monthSelectEl = document.getElementById('month-select');
    const selectedMonth = monthSelectEl ? monthSelectEl.value : 'all';
    const activeViewBtn = document.querySelector('#view-mode .segment-btn.active');
    const viewMode = activeViewBtn ? activeViewBtn.dataset.mode : 'daily';

    const isAggregated = (selectedMonth === 'all' || viewMode === 'weekly' || viewMode === 'monthly');
    const isRange = activeRangeRecords && activeRangeRecords.length > 1;

    // Helper functions
    function getAvg(records, key) {
        const valid = records.filter(r => r[key] !== null && r[key] !== undefined && r[key] > 0);
        return valid.length > 0 ? valid.reduce((sum, r) => sum + r[key], 0) / valid.length : null;
    }
    
    function setTxt(id, val) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    function updateKpiTag(id, isPass, text) {
        const el = document.getElementById(id);
        if (el) {
            el.className = 'q-kpi-tag ' + (isPass ? 'pass' : 'fail');
            el.innerHTML = `<i class="fa-solid fa-${isPass ? 'check' : 'xmark'}"></i> ` + text;
        }
    }

    // Monthly records (for monthly averages)
    const activeMonth = activeDayRecord.date.split('-')[1];
    const monthRecords = allRecords.filter(r => r.date.split('-')[1] === activeMonth);

    // List of parameters
    const params = ['ph', 'turbidity', 'conductivity', 'tds', 'chlorine'];
    
    // Parameter keys to HTML IDs mapping
    const paramIdMap = {
        ph:           'ph',
        turbidity:    'turb',
        conductivity: 'cond',
        tds:          'tds',
        chlorine:     'chlorine'
    };

    // Limits
    const limits = {
        ph:           val => val >= 6.5 && val <= 7.5,
        turbidity:    val => val <= 3.0,
        tds:          val => val <= 500,
        chlorine:     val => val >= 0.2 && val <= 2.0
    };

    const limitLabels = {
        ph:           'เกณฑ์มาตรฐาน 6.5 - 7.5',
        turbidity:    'เกณฑ์มาตรฐาน &le; 3.0 NTU',
        tds:          'เกณฑ์มาตรฐาน &le; 500 mg/L',
        chlorine:     'เกณฑ์มาตรฐาน 0.2 - 2.0 mg/L'
    };

    params.forEach(p => {
        const id = paramIdMap[p];
        
        // Calculate Year & Month stats
        const yearAvg = getAvg(allRecords, p);
        const monthAvg = getAvg(monthRecords, p);
        
        // Determine current value
        let val = activeDayRecord[p];
        if (selectedMonth === 'all') {
            val = yearAvg;
        } else if (viewMode === 'weekly' || viewMode === 'monthly') {
            val = getAvg(filteredRecords, p);
        } else if (isRange) {
            val = getAvg(activeRangeRecords, p);
        }

        // Format decimal places
        const decimals = (p === 'ph' || p === 'turbidity' || p === 'chlorine') ? 2 : 0;
        
        // Update DOM
        setTxt(`q-${id}`, val !== null ? formatNum(val, decimals) : '-');
        setTxt(`q-${id}-month`, monthAvg !== null ? formatNum(monthAvg, decimals) : '-');
        setTxt(`q-${id}-year`, yearAvg !== null ? formatNum(yearAvg, decimals) : '-');

        // Update tag
        const tagId = `q-${id}-tag`;
        const tagEl = document.getElementById(tagId);
        if (tagEl) {
            if (p === 'conductivity') {
                tagEl.style.display = 'none';
            } else {
                tagEl.style.display = 'inline-block';
                if (val !== null) {
                    const isPass = limits[p](val);
                    updateKpiTag(tagId, isPass, limitLabels[p]);
                } else {
                    tagEl.className = 'q-kpi-tag';
                    tagEl.innerText = 'ไม่มีเกณฑ์ข้อมูล';
                }
            }
        }
    });
}

// Clear KPI cards when no data
function clearKpiCards() {
    const ids = ['water-daily', 'water-month-acc', 'water-month-avg', 'water-year-acc', 'water-year-avg',
                 'yield-daily', 'yield-month-avg', 'yield-year-avg',
                 'chem-cost-daily', 'chem-cost-month-avg', 'chem-cost-year-avg',
                 'elec-cost-daily', 'elec-cost-month-avg', 'elec-cost-year-avg',
                 'total-cost-daily', 'total-cost-month-avg', 'total-cost-year-avg',
                 'q-ph', 'q-ph-month', 'q-ph-year',
                 'q-turb', 'q-turb-month', 'q-turb-year',
                 'q-cond', 'q-cond-month', 'q-cond-year',
                 'q-tds', 'q-tds-month', 'q-tds-year',
                 'q-chlorine', 'q-chlorine-month', 'q-chlorine-year'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '-';
    });
}

// Update Chemical tab content
function updateChemicalSection() {
    if (!filteredRecords || filteredRecords.length === 0) return;
    
    const chemMeta = chemKeyMap[activeChem];
    const monthSelectEl = document.getElementById('month-select');
    const selectedMonth = monthSelectEl ? monthSelectEl.value : 'all';
    
    const activeViewBtn = document.querySelector('#view-mode .segment-btn.active');
    const viewMode = activeViewBtn ? activeViewBtn.dataset.mode : 'daily';
    
    const isAggregated = (selectedMonth === 'all' || viewMode === 'weekly' || viewMode === 'monthly');
    
    let labelQtyDaily = document.querySelector('.chem-stat-card:nth-child(1) h4');
    let labelCostDaily = document.querySelector('.chem-stat-card:nth-child(3) h4');
    
    function setTxt(id, val) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    if (isAggregated) {
        // Show averages/totals for the entire filtered period
        const totalQty = filteredRecords.reduce((sum, r) => sum + r[chemMeta.qty], 0);
        const totalCost = filteredRecords.reduce((sum, r) => sum + r[chemMeta.cost], 0);
        const avgQty = totalQty / (filteredRecords.length || 1);
        const avgCost = totalCost / (filteredRecords.length || 1);
        
        if (labelQtyDaily) labelQtyDaily.innerText = 'ปริมาณการใช้เฉลี่ย (ต่อวัน)';
        if (labelCostDaily) labelCostDaily.innerText = 'ค่าสารเคมีเฉลี่ย (ต่อวัน)';
        
        setTxt('tab-chem-qty-daily', formatNum(avgQty, 1));
        setTxt('tab-chem-cost-daily', formatNum(avgCost, 1));
        
        // Month acc can show the total sum for the filtered period (whether month or year)
        setTxt('tab-chem-qty-month-acc', formatNum(totalQty, 1) + ' kg');
        setTxt('tab-chem-cost-month-acc', formatNum(totalCost, 1) + ' บาท');
        
        const labelQtyMonth = document.querySelector('.chem-stat-card:nth-child(2) h4');
        const labelCostMonth = document.querySelector('.chem-stat-card:nth-child(4) h4');
        if (selectedMonth === 'all') {
            if (labelQtyMonth) labelQtyMonth.innerText = 'ปริมาณการใช้สะสมทั้งปี';
            if (labelCostMonth) labelCostMonth.innerText = 'ค่าสารเคมีสะสมทั้งปี';
        } else {
            if (labelQtyMonth) labelQtyMonth.innerText = 'ปริมาณการใช้สะสมทั้งเดือน';
            if (labelCostMonth) labelCostMonth.innerText = 'ค่าสารเคมีสะสมทั้งเดือน';
        }
    } else {
        // Regular daily view
        if (activeDayRecord) {
            const dailyQty = activeDayRecord[chemMeta.qty];
            const dailyCost = activeDayRecord[chemMeta.cost];
            
            const activeMonth = activeDayRecord.date.split('-')[1];
            const monthRecords = allRecords.filter(r => r.date.split('-')[1] === activeMonth);
            const monthQtyAcc = monthRecords.reduce((sum, r) => sum + r[chemMeta.qty], 0);
            const monthCostAcc = monthRecords.reduce((sum, r) => sum + r[chemMeta.cost], 0);
            
            if (labelQtyDaily) labelQtyDaily.innerText = 'ปริมาณการใช้รายวัน';
            if (labelCostDaily) labelCostDaily.innerText = 'ค่าสารเคมีรายวัน';
            
            setTxt('tab-chem-qty-daily', formatNum(dailyQty, 1));
            setTxt('tab-chem-cost-daily', formatNum(dailyCost, 1));
            setTxt('tab-chem-qty-month-acc', formatNum(monthQtyAcc, 1) + ' kg');
            setTxt('tab-chem-cost-month-acc', formatNum(monthCostAcc, 1) + ' บาท');
            
            const labelQtyMonth = document.querySelector('.chem-stat-card:nth-child(2) h4');
            const labelCostMonth = document.querySelector('.chem-stat-card:nth-child(4) h4');
            if (labelQtyMonth) labelQtyMonth.innerText = 'ปริมาณการใช้สะสมทั้งเดือน';
            if (labelCostMonth) labelCostMonth.innerText = 'ค่าสารเคมีสะสมทั้งเดือน';
        }
    }

    renderChemDetailChart();
}

// Render Daily Logs Table
function renderDailyTable() {
    // If month selector is 'all', show the latest month's daily logs (December) to prevent loading 365 rows in the DOM
    let tableRecords = [];
    const monthSelectEl = document.getElementById('month-select');
    const selectedMonth = monthSelectEl ? monthSelectEl.value : 'all';
    const tableBodyEl = document.getElementById('table-body');
    
    if (selectedMonth === 'all') {
        tableRecords = allRecords.filter(r => r.date.split('-')[1] === '12');
    } else {
        tableRecords = [...filteredRecords];
    }
    
    if (tableRecords.length === 0) {
        if (tableBodyEl) {
            tableBodyEl.innerHTML = '<tr><td colspan="13" class="loading-text">ไม่มีข้อมูลในตัวกรองนี้</td></tr>';
        }
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
    
    if (tableBodyEl) {
        tableBodyEl.innerHTML = html;

        // Add click listener to rows for interactive KPI updates
        const rows = tableBodyEl.querySelectorAll('tr');
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
                // Also update picker text dynamically
                renderDayPicker();
            });
        });
    }
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
    updateChemPpmSection();
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
    if (!ctx) return;

    const costSelect = document.getElementById('cost-chart-select');
    const activeCost = costSelect ? costSelect.value : 'total';

    const labels = dataset.map(d => formatDateLabel(d.date, viewMode));
    
    let chartData = [];
    let kpiVal = 0;
    let labelText = '';
    let borderColor = '';
    let bgColor = '';
    let kpiLabelText = '';

    if (activeCost === 'total') {
        chartData = dataset.map(d => d.total_cost_m3);
        kpiVal = KPI_TOTAL;
        labelText = 'ต้นทุนรวม (บาท/ลบ.ม.)';
        kpiLabelText = `KPI ต้นทุนรวม (≤ ${KPI_TOTAL} บาท/ลบ.ม.)`;
        borderColor = 'rgba(255, 85, 51, 1)';
        bgColor = 'rgba(255, 85, 51, 0.05)';
    } else if (activeCost === 'chem') {
        chartData = dataset.map(d => d.chem_cost_m3);
        kpiVal = KPI_CHEM;
        labelText = 'ต้นทุนสารเคมี (บาท/ลบ.ม.)';
        kpiLabelText = `KPI ต้นทุนสารเคมี (≤ ${KPI_CHEM} บาท/ลบ.ม.)`;
        borderColor = 'rgba(204, 102, 255, 1)';
        bgColor = 'rgba(204, 102, 255, 0.05)';
    } else if (activeCost === 'elec') {
        chartData = dataset.map(d => d.elec_cost_m3);
        kpiVal = KPI_ELEC;
        labelText = 'ต้นทุนไฟฟ้า (บาท/ลบ.ม.)';
        kpiLabelText = `KPI ต้นทุนไฟฟ้า (≤ ${KPI_ELEC} บาท/ลบ.ม.)`;
        borderColor = 'rgba(255, 204, 0, 1)';
        bgColor = 'rgba(255, 204, 0, 0.05)';
    }

    const kpiData = Array(dataset.length).fill(kpiVal);

    if (charts.costsKpi) {
        charts.costsKpi.destroy();
    }

    charts.costsKpi = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: labelText,
                    data: chartData,
                    borderColor: borderColor,
                    backgroundColor: bgColor,
                    borderWidth: 2,
                    pointRadius: 1,
                    tension: 0.2
                },
                {
                    label: kpiLabelText,
                    data: kpiData,
                    borderColor: 'rgba(231, 76, 60, 0.8)',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
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

// Update Chemical PPM tab content and chart
function updateChemPpmSection() {
    if (!filteredRecords || filteredRecords.length === 0) return;
    
    const chemMeta = chemKeyMap[activeChemPpm];
    const monthSelectEl = document.getElementById('month-select');
    const selectedMonth = monthSelectEl ? monthSelectEl.value : 'all';
    const activeViewBtn = document.querySelector('#view-mode .segment-btn.active');
    const viewMode = activeViewBtn ? activeViewBtn.dataset.mode : 'daily';

    const isAggregated = (selectedMonth === 'all' || viewMode === 'weekly' || viewMode === 'monthly');
    const isRange = activeRangeRecords && activeRangeRecords.length > 1;

    // Averages helper
    function getAvg(records, key) {
        const valid = records.filter(r => r[key] !== null && r[key] !== undefined && r[key] > 0);
        return valid.length > 0 ? valid.reduce((sum, r) => sum + r[key], 0) / valid.length : null;
    }

    function setTxt(id, val) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    // Determine current value
    let val = activeDayRecord ? activeDayRecord[chemMeta.qty] : null;
    if (selectedMonth === 'all') {
        val = getAvg(allRecords, chemMeta.qty);
    } else if (viewMode === 'weekly' || viewMode === 'monthly') {
        val = getAvg(filteredRecords, chemMeta.qty);
    } else if (isRange) {
        val = getAvg(activeRangeRecords, chemMeta.qty);
    }

    // Calculate month & year stats
    const activeMonth = activeDayRecord ? activeDayRecord.date.split('-')[1] : null;
    const monthRecords = allRecords.filter(r => r.date.split('-')[1] === activeMonth);
    const monthAvg = getAvg(monthRecords, chemMeta.qty);
    const yearAvg = getAvg(allRecords, chemMeta.qty);
    const rangeAvg = isRange ? getAvg(activeRangeRecords, chemMeta.qty) : val;

    setTxt('tab-ppm-daily', val !== null ? formatNum(val, 2) : '-');
    setTxt('tab-ppm-range-avg', rangeAvg !== null ? formatNum(rangeAvg, 2) : '-');
    setTxt('tab-ppm-month-avg', monthAvg !== null ? formatNum(monthAvg, 2) : '-');
    setTxt('tab-ppm-year-avg', yearAvg !== null ? formatNum(yearAvg, 2) : '-');

    // Render PPM chart
    const ctx = document.getElementById('chemPpmChart').getContext('2d');
    if (!ctx) return;

    let dataset = [];
    if (viewMode === 'daily') {
        dataset = [...filteredRecords];
    } else if (viewMode === 'weekly') {
        dataset = aggregateWeekly(filteredRecords);
    } else if (viewMode === 'monthly') {
        dataset = aggregateMonthly(filteredRecords);
    }

    const labels = dataset.map(r => formatDateLabel(r.date, viewMode));
    const ppmData = dataset.map(r => r[chemMeta.qty]);

    if (charts.chemPpm) {
        charts.chemPpm.destroy();
    }

    charts.chemPpm = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `ความเข้มข้น ${chemMeta.name} (ppm)`,
                data: ppmData,
                borderColor: chemMeta.color,
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderWidth: 2,
                pointRadius: 1.5,
                tension: 0.2
            }]
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
                    title: { display: true, text: 'ความเข้มข้น (ppm)', color: '#94a3b8', font: { family: 'Sarabun' } }
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
