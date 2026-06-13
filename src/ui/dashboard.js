/**
 * Antigravity Proxy - Frontend Renderer Controller
 */

const { ipcRenderer, shell } = require('electron');
const i18n = require('./src/shared/i18n');

// State Variables
let currentLanguage = 'zh';
let currentTheme = 'dark';
let activeTab = 'logs'; // Default to logs in Design 4
let trendsData = [];
let allRequests = [];
let searchQuery = '';
let currentRange = 'today';
let customStartDate = null;
let customEndDate = null;
let quotaCache = {}; // Cache for account quota buckets: { accountId: buckets }

// Pagination
let currentPage = 1;
const itemsPerPage = 8;

// DOM Elements
const body = document.body;
const html = document.documentElement;

// Header Controls
const proxyToggle = document.getElementById('proxyToggle');
const proxyToggleLabel = document.getElementById('proxyToggleLabel');
const statusText = document.getElementById('statusText');
const certStatusBadge = document.getElementById('certStatusBadge');
const btnInstallCert = document.getElementById('btnInstallCert');
const btnUninstallCert = document.getElementById('btnUninstallCert');

// Metrics Cards
const valReqs = document.getElementById('valReqs');
const valTokens = document.getElementById('valTokens');
const valTokensIn = document.getElementById('valTokensIn');
const valTokensOut = document.getElementById('valTokensOut');
const valCached = document.getElementById('valCached');
const valSavedCost = document.getElementById('valSavedCost');
const valHitRate = document.getElementById('valHitRate');
const gaugeCircle = document.getElementById('gaugeCircle');
const barTokensIn = document.getElementById('barTokensIn');
const barTokensOut = document.getElementById('barTokensOut');

// Tab Controls
const tabModels = document.getElementById('tabModels');
const tabLogs = document.getElementById('tabLogs');
const tabPricing = document.getElementById('tabPricing');
const modelsContent = document.getElementById('modelsContent');
const logsContent = document.getElementById('logsContent');
const pricingContent = document.getElementById('pricingContent');
const logSearchRow = document.getElementById('logSearchRow');
const tableFooter = document.getElementById('tableFooter');

// Tables
const modelsTableBody = document.querySelector('#modelsTable tbody');
const logsTableBody = document.querySelector('#logsTable tbody');
const pricingTableBody = document.querySelector('#pricingTable tbody');
const logSearchInput = document.getElementById('logSearchInput');

// Pagination elements
const valShowingText = document.getElementById('valShowingText');
const paginationControls = document.getElementById('paginationControls');

// Console Log Panel
const consoleHeader = document.getElementById('consoleHeader');
const systemConsole = document.getElementById('systemConsole');
const consoleBody = document.getElementById('consoleBody');

// Toggles in Header
const toggleZH = document.getElementById('toggleZH');
const toggleEN = document.getElementById('toggleEN');
const toggleTheme = document.getElementById('toggleTheme');
const themeIcon = document.getElementById('themeIcon');
const btnExportLogs = document.getElementById('btnExportLogs');

// Format Numbers
function formatCompactNumber(number) {
    if (number >= 1000000) {
        return (number / 1000000).toFixed(2) + 'M';
    }
    if (number >= 1000) {
        return (number / 1000).toFixed(1) + 'k';
    }
    return number.toFixed(0);
}

// Helper for calculating smooth bezier curves
function getBezierPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const cpX1 = p0.x + (p1.x - p0.x) / 2;
        const cpY1 = p0.y;
        const cpX2 = p0.x + (p1.x - p0.x) / 2;
        const cpY2 = p1.y;
        d += ` C ${cpX1.toFixed(1)},${cpY1.toFixed(1)} ${cpX2.toFixed(1)},${cpY2.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }
    return d;
}

// Draw SVG Line Chart
// Draw SVG Line Chart
// Draw SVG Line Chart
function drawTrendChartSVG(trends, range = '7d') {
    const trendSvg = document.getElementById('trendSvg');
    const costPath = document.getElementById('chartPathCost');
    const inputPath = document.getElementById('chartPathInput');
    const outputPath = document.getElementById('chartPathOutput');
    const cachedPath = document.getElementById('chartPathCached');
    const cacheCreatedPath = document.getElementById('chartPathCacheCreated');
    const inputArea = document.getElementById('chartAreaInput');
    const cachedArea = document.getElementById('chartAreaCached');
    const gridLinesGroup = document.getElementById('chartGridLines');
    const sensorRect = document.getElementById('chartSensor');

    const leftAxis = document.getElementById('chartLeftAxis');
    const rightAxis = document.getElementById('chartRightAxis');
    const xAxis = document.getElementById('chartXAxis');

    if (!trendSvg || !trends || trends.length === 0) return;

    const N = trends.length;
    // With axes moved out of SVG, our drawing width is full viewBox width
    const xMin = 0, xMax = 1000;
    const yMin = 20, yMax = 265;

    // Calculate maximum values
    let maxTokens = 1000;
    let maxCost = 0.01;
    trends.forEach(d => {
        const tokenMax = Math.max(d.input || 0, d.output || 0, d.cached || 0, d.cacheCreated || 0);
        if (tokenMax > maxTokens) maxTokens = tokenMax;
        if ((d.cost || 0) > maxCost) maxCost = d.cost;
    });

    // Padding values
    maxTokens = Math.ceil(maxTokens * 1.15);
    maxCost = maxCost * 1.15;

    // Reset Axis Containers
    gridLinesGroup.innerHTML = '';
    leftAxis.innerHTML = '';
    rightAxis.innerHTML = '';
    xAxis.innerHTML = '';

    // 1. Draw horizontal grid lines (SVG) & Y labels (HTML)
    // HTML labels are absolutely positioned based on the same ratio as grid lines
    for (let i = 4; i >= 0; i--) {
        const ratio = i / 4;
        const y = yMax - ratio * (yMax - yMin);
        
        // Grid Line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', xMin);
        line.setAttribute('y1', y.toFixed(1));
        line.setAttribute('x2', xMax);
        line.setAttribute('y2', y.toFixed(1));
        line.setAttribute('stroke-width', '1');
        if (i > 0 && i < 4) {
            line.setAttribute('stroke-dasharray', '3,3');
        }
        gridLinesGroup.appendChild(line);

        // Left HTML Token label (positioned precisely by top percentage)
        const tokenVal = ratio * maxTokens;
        const leftLabel = document.createElement('div');
        leftLabel.className = 'absolute right-2 -translate-y-1/2 font-sans text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap select-none';
        leftLabel.style.top = `${(y / 300) * 100}%`;
        leftLabel.textContent = formatCompactNumber(tokenVal);
        leftAxis.appendChild(leftLabel);

        // Right HTML Cost label (positioned precisely by top percentage)
        const costVal = ratio * maxCost;
        const rightLabel = document.createElement('div');
        rightLabel.className = 'absolute left-2 -translate-y-1/2 font-sans text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap select-none';
        rightLabel.style.top = `${(y / 300) * 100}%`;
        rightLabel.textContent = costVal === 0 ? '$0' : `$${costVal.toFixed(costVal < 1 ? 4 : 2)}`;
        rightAxis.appendChild(rightLabel);
    }

    // 2. Draw X Labels in HTML using absolute percentages
    // If range is today or custom-filtering only spans 1 day, show HH:00, else show date MM/DD
    let isSingleDay = range === 'today';
    if (range === 'custom' && trends.length > 0) {
        const firstDay = trends[0].time.split(' ')[0];
        const lastDay = trends[trends.length - 1].time.split(' ')[0];
        if (firstDay === lastDay) {
            isSingleDay = true;
        }
    }

    const indices = [];
    if (N <= 7) {
        for (let i = 0; i < N; i++) indices.push(i);
    } else {
        indices.push(0);
        for (let i = 1; i < 6; i++) {
            indices.push(Math.round((i / 6) * (N - 1)));
        }
        indices.push(N - 1);
    }

    indices.forEach(idx => {
        const d = trends[idx];
        const percent = (idx / (N - 1)) * 100;
        const label = document.createElement('div');
        label.className = 'absolute -translate-x-1/2 text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap font-sans';
        label.style.left = `${percent}%`;
        
        if (isSingleDay) {
            label.textContent = d.time ? (d.time.split(' ')[1] || d.time) : '';
        } else {
            label.textContent = d.time ? d.time.split(' ')[0] : '';
        }
        xAxis.appendChild(label);
    });

    // 3. Coordinate calculation helpers
    const getX = (idx) => xMin + (idx / Math.max(1, N - 1)) * (xMax - xMin);
    const getYToken = (val) => yMax - ((val || 0) / maxTokens) * (yMax - yMin);
    const getYCost = (val) => yMax - ((val || 0) / maxCost) * (yMax - yMin);

    const costPoints = trends.map((d, idx) => ({ x: getX(idx), y: getYCost(d.cost) }));
    const inputPoints = trends.map((d, idx) => ({ x: getX(idx), y: getYToken(d.input) }));
    const outputPoints = trends.map((d, idx) => ({ x: getX(idx), y: getYToken(d.output) }));
    const cachedPoints = trends.map((d, idx) => ({ x: getX(idx), y: getYToken(d.cached) }));
    const cacheCreatedPoints = trends.map((d, idx) => ({ x: getX(idx), y: getYToken(d.cacheCreated) }));

    // 4. Generate & apply smooth paths
    const costD = getBezierPath(costPoints);
    const inputD = getBezierPath(inputPoints);
    const outputD = getBezierPath(outputPoints);
    const cachedD = getBezierPath(cachedPoints);
    const cacheCreatedD = getBezierPath(cacheCreatedPoints);

    costPath.setAttribute('d', costD);
    inputPath.setAttribute('d', inputD);
    outputPath.setAttribute('d', outputD);
    cachedPath.setAttribute('d', cachedD);
    cacheCreatedPath.setAttribute('d', cacheCreatedD);

    // 5. Generate & apply areas
    if (N > 0) {
        const inputAreaD = inputD + ` L ${xMax},${yMax} L ${xMin},${yMax} Z`;
        inputArea.setAttribute('d', inputAreaD);

        const cachedAreaD = cachedD + ` L ${xMax},${yMax} L ${xMin},${yMax} Z`;
        cachedArea.setAttribute('d', cachedAreaD);
    }

    // 6. Interactive Hover Tooltip & Points
    const hoverLine = document.getElementById('chartHoverLine');
    const hoverPointsGroup = document.getElementById('chartHoverPoints');
    const tooltip = document.getElementById('chartTooltip');

    const ptCost = document.getElementById('hoverPointCost');
    const ptCacheCreated = document.getElementById('hoverPointCacheCreated');
    const ptCached = document.getElementById('hoverPointCached');
    const ptInput = document.getElementById('hoverPointInput');
    const ptOutput = document.getElementById('hoverPointOutput');

    const showHover = (idx) => {
        if (idx < 0 || idx >= N) return;
        const d = trends[idx];
        const x = getX(idx);

        const yCost = getYCost(d.cost);
        const yCacheCreated = getYToken(d.cacheCreated);
        const yCached = getYToken(d.cached);
        const yInput = getYToken(d.input);
        const yOutput = getYToken(d.output);

        // Position vertical indicator line
        hoverLine.setAttribute('x1', x.toFixed(1));
        hoverLine.setAttribute('x2', x.toFixed(1));
        hoverLine.setAttribute('opacity', '1');

        // Position focus circles using CSS percentages to prevent deformation
        const px = `${(x / 10).toFixed(2)}%`;
        ptCost.style.left = px; ptCost.style.top = `${(yCost / 3).toFixed(2)}%`;
        ptCacheCreated.style.left = px; ptCacheCreated.style.top = `${(yCacheCreated / 3).toFixed(2)}%`;
        ptCached.style.left = px; ptCached.style.top = `${(yCached / 3).toFixed(2)}%`;
        ptInput.style.left = px; ptInput.style.top = `${(yInput / 3).toFixed(2)}%`;
        ptOutput.style.left = px; ptOutput.style.top = `${(yOutput / 3).toFixed(2)}%`;
        hoverPointsGroup.style.opacity = '1';

        // Update Tooltip contents
        document.getElementById('tooltipDate').textContent = d.time || '';
        document.getElementById('tooltipInput').textContent = (d.input || 0).toLocaleString();
        document.getElementById('tooltipOutput').textContent = (d.output || 0).toLocaleString();
        document.getElementById('tooltipCacheCreated').textContent = (d.cacheCreated || 0).toLocaleString();
        document.getElementById('tooltipCached').textContent = (d.cached || 0).toLocaleString();
        document.getElementById('tooltipCost').textContent = `$${(d.cost || 0).toFixed(6)}`;

        // Coordinate positioning for Tooltip
        const containerWidth = sensorRect.getBoundingClientRect().width;
        const scale = containerWidth / 1000;
        const tooltipX = x * scale;

        tooltip.style.opacity = '1';
        if (tooltipX > containerWidth * 0.7) {
            tooltip.style.left = `${tooltipX - 180 + 48}px`; // Compensate left HTML axis offset w-12 (48px)
        } else {
            tooltip.style.left = `${tooltipX + 15 + 48}px`;
        }
        tooltip.style.top = `15px`;
    };

    const hideHover = () => {
        hoverLine.setAttribute('opacity', '0');
        hoverPointsGroup.style.opacity = '0';
        tooltip.style.opacity = '0';
        tooltip.style.left = '-1000px';
    };

    sensorRect.onmousemove = (e) => {
        const rect = sensorRect.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const width = rect.width;
        const ratio = mouseX / width;
        const idx = Math.min(N - 1, Math.max(0, Math.round(ratio * (N - 1))));
        showHover(idx);
    };

    sensorRect.onmouseleave = () => {
        hideHover();
    };
}

// Multi-language Text Translation
function setLanguage(lang) {
    currentLanguage = lang;
    
    // Toggle active segment buttons style
    if (lang === 'zh') {
        toggleZH.className = 'px-2 py-0.5 text-[11px] font-medium bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim rounded-full shadow-sm';
        toggleEN.className = 'px-2 py-0.5 text-[11px] font-medium text-outline rounded-full transition-all';
    } else {
        toggleEN.className = 'px-2 py-0.5 text-[11px] font-medium bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim rounded-full shadow-sm';
        toggleZH.className = 'px-2 py-0.5 text-[11px] font-medium text-outline rounded-full transition-all';
    }
    
    const dict = i18n[lang];
    
    // Update labels with [data-i18n]
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            el.textContent = dict[key];
        }
    });

    // Update dynamic content placeholder titles
    logSearchInput.placeholder = lang === 'zh' ? '搜索日志...' : 'Search logs...';

    updateStatusLabel();
    ipcRenderer.send('get-state');
}

function updateStatusLabel() {
    const isIntercept = proxyToggle.checked;
    const dict = i18n[currentLanguage];
    statusText.textContent = isIntercept ? dict.statusOn : dict.statusOff;
    
    if (isIntercept) {
        statusText.className = 'text-[13px] font-bold text-emerald-600 dark:text-emerald-400';
        proxyToggle.className = 'toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 border-primary appearance-none cursor-pointer translate-x-5 transition-transform duration-200 ease-in-out';
        proxyToggleLabel.className = 'toggle-label block overflow-hidden h-5 rounded-full bg-primary cursor-pointer';
    } else {
        statusText.className = 'text-[13px] font-bold text-outline';
        proxyToggle.className = 'toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out';
        proxyToggleLabel.className = 'toggle-label block overflow-hidden h-5 rounded-full bg-outline-variant/50 dark:bg-white/10 cursor-pointer';
    }
}

// Theme Change Handler
function setTheme(theme) {
    currentTheme = theme;
    if (theme === 'dark') {
        html.classList.add('dark');
        html.setAttribute('data-theme', 'dark');
        themeIcon.textContent = 'light_mode'; // Icon represents what to switch to, or current
    } else {
        html.classList.remove('dark');
        html.setAttribute('data-theme', 'light');
        themeIcon.textContent = 'dark_mode';
    }
}

// UI tab switching
function switchTab(tab) {
    activeTab = tab;
    
    const activeClass = 'px-4 py-2 text-[13px] font-bold text-primary border-b-2 border-primary';
    const inactiveClass = 'px-4 py-2 text-[13px] font-bold text-outline hover:text-primary transition-colors border-b-2 border-transparent';
    
    tabModels.className = tab === 'models' ? activeClass : inactiveClass;
    tabLogs.className = tab === 'logs' ? activeClass : inactiveClass;
    tabPricing.className = tab === 'pricing' ? activeClass : inactiveClass;
    
    modelsContent.classList.toggle('hidden', tab !== 'models');
    logsContent.classList.toggle('hidden', tab !== 'logs');
    pricingContent.classList.toggle('hidden', tab !== 'pricing');
    
    // Hide log search row and pagination footer for non-log tabs
    if (logSearchRow) {
        logSearchRow.classList.toggle('hidden', tab !== 'logs');
    }
    if (tableFooter) {
        tableFooter.classList.toggle('hidden', tab !== 'logs');
    }

    if (tab === 'pricing') {
        fetchPricing();
    }
}

// Update Certificate Installation UI
function updateCertUI(isInstalled, isProcessing = false) {
    const dict = i18n[currentLanguage];
    if (isProcessing) {
        certStatusBadge.innerHTML = `<span class="material-symbols-outlined text-[15px] animate-spin">sync</span><span>${dict.certProcessing}</span>`;
        certStatusBadge.className = 'flex items-center gap-1.5 text-[12px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 px-2.5 py-0.5 rounded-full border border-amber-100 dark:border-amber-900/30';
        btnInstallCert.disabled = true;
        btnUninstallCert.disabled = true;
        return;
    }

    if (isInstalled) {
        certStatusBadge.innerHTML = `<span class="material-symbols-outlined text-[15px]">verified</span><span>${dict.certTrusted}</span>`;
        certStatusBadge.className = 'flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-100 dark:border-emerald-900/30';
        btnInstallCert.disabled = true;
        btnUninstallCert.disabled = false;
    } else {
        certStatusBadge.innerHTML = `<span class="material-symbols-outlined text-[15px]">gpp_maybe</span><span>${dict.certUntrusted}</span>`;
        certStatusBadge.className = 'flex items-center gap-1.5 text-[12px] font-medium text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400 px-2.5 py-0.5 rounded-full border border-rose-100 dark:border-rose-900/30';
        btnInstallCert.disabled = false;
        btnUninstallCert.disabled = true;
    }
}

// Filter and render logs table with pagination
function renderLogsTable() {
    const dict = i18n[currentLanguage];
    
    // Filter requests
    const filtered = allRequests.filter(log => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return log.host.toLowerCase().includes(q) || 
               log.path.toLowerCase().includes(q) || 
               log.model.toLowerCase().includes(q) || 
               log.method.toLowerCase().includes(q);
    });

    // Pagination bounds
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const paginated = filtered.slice(startIndex, endIndex);

    // Render table
    logsTableBody.innerHTML = '';
    if (paginated.length === 0) {
        logsTableBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-outline dark:text-outline-variant italic">${dict.noLogs}</td></tr>`;
        valShowingText.textContent = currentLanguage === 'zh' 
            ? `共 0 条记录` 
            : `Showing 0 entries`;
    } else {
        paginated.forEach(log => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 dark:hover:bg-white/5 transition-colors';
            
            let statusClass = 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-900/40 dark:text-slate-400 dark:border-slate-800';
            let statusLabel = dict.statusMiss;
            if (log.cacheStatus === 'HIT') {
                statusClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30';
                statusLabel = dict.statusHit;
            } else if (log.cacheStatus === 'NONE') {
                statusClass = 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/30';
                statusLabel = dict.statusNone;
            }

            const isError = log.statusCode >= 400;
            const statusColor = isError ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400';
            
            const hitRateVal = log.inTokens > 0 ? (log.cachedTokens / log.inTokens * 100).toFixed(1) : '0.0';
            const hitRateColor = log.cachedTokens > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-400 dark:text-slate-500';

            tr.innerHTML = `
                <td class="p-3 text-outline dark:text-outline-variant font-data-mono text-[12px] whitespace-nowrap">${log.timestamp}</td>
                <td class="p-3 font-data-mono truncate" title="${log.method} ${log.host}">
                    <span class="text-[#0ea5e9] font-bold mr-2">${log.method}</span>
                    <span class="text-on-surface dark:text-white">${log.host}</span>
                </td>
                <td class="p-3 text-outline dark:text-outline-variant font-data-mono text-[12px] truncate" title="${log.path}">${log.path}</td>
                <td class="p-3 font-sans font-medium text-on-surface dark:text-white truncate" title="${log.model}">${log.model}</td>
                <td class="p-3 text-right font-data-mono">
                    <div class="flex flex-col items-end">
                        <span class="text-[10px] text-outline dark:text-outline-variant">${dict.input}: ${log.inTokens.toLocaleString()}</span>
                        <span class="text-on-surface dark:text-white">${dict.output}: ${log.outTokens.toLocaleString()}</span>
                    </div>
                </td>
                <td class="p-3 text-right font-data-mono text-emerald-600 dark:text-emerald-400 font-bold">$${(log.cost || 0).toFixed(6)}</td>
                <td class="p-3 text-center font-data-mono ${hitRateColor}">${hitRateVal}%</td>
                <td class="p-3 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${statusClass}">${statusLabel}</span>
                    <span class="block text-[10px] font-bold ${statusColor} mt-1">HTTP ${log.statusCode}</span>
                </td>
                <td class="p-3 text-center">
                    <button class="px-2 py-1 text-[11px] bg-primary/10 hover:bg-primary/20 text-primary dark:text-primary-fixed-dim rounded font-medium transition-all view-details-btn">
                        查看
                    </button>
                </td>
            `;

            const detailBtn = tr.querySelector('.view-details-btn');
            if (detailBtn) {
                detailBtn.addEventListener('click', () => {
                    showModal(log);
                });
            }

            logsTableBody.appendChild(tr);
        });

        const showingText = currentLanguage === 'zh'
            ? `显示第 ${startIndex + 1} 到 ${endIndex} 条，共 ${totalItems} 条记录`
            : `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} entries`;
        valShowingText.textContent = showingText;
    }

    // Render Pagination Controls
    paginationControls.innerHTML = '';
    
    const addBtn = (label, pageNum, isActive = false, isDisabled = false) => {
        const btn = document.createElement('button');
        btn.className = `px-2.5 py-1 border border-outline-variant/60 rounded text-[12px] transition-colors ${
            isActive ? 'bg-primary text-white border-primary dark:bg-primary-container dark:border-primary-container' : 'bg-white dark:bg-[#1a1f30] text-on-surface dark:text-white hover:bg-slate-50 dark:hover:bg-white/5'
        } ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`;
        btn.textContent = label;
        if (!isDisabled) {
            btn.addEventListener('click', () => {
                currentPage = pageNum;
                renderLogsTable();
            });
        } else {
            btn.disabled = true;
        }
        paginationControls.appendChild(btn);
    };

    // Prev Button
    addBtn(currentLanguage === 'zh' ? '上一页' : 'Prev', currentPage - 1, false, currentPage === 1);

    // Page numbers
    let startPage = Math.max(1, currentPage - 1);
    let endPage = Math.min(totalPages, startPage + 2);
    if (endPage - startPage < 2) {
        startPage = Math.max(1, endPage - 2);
    }

    for (let p = startPage; p <= endPage; p++) {
        addBtn(p.toString(), p, p === currentPage);
    }

    if (endPage < totalPages) {
        const span = document.createElement('span');
        span.className = 'px-1 text-outline align-bottom';
        span.textContent = '...';
        paginationControls.appendChild(span);
        addBtn(totalPages.toString(), totalPages);
    }

    // Next Button
    addBtn(currentLanguage === 'zh' ? '下一页' : 'Next', currentPage + 1, false, currentPage === totalPages);
}

// Event Listeners for Intercept Toggle
proxyToggle.addEventListener('change', (e) => {
    const isInterceptMode = e.target.checked;
    updateStatusLabel();
    ipcRenderer.send('toggle', isInterceptMode);
});

// CA Cert Operations
btnInstallCert.addEventListener('click', () => {
    updateCertUI(false, true);
    ipcRenderer.send('cert-install');
});

btnUninstallCert.addEventListener('click', () => {
    updateCertUI(false, true);
    ipcRenderer.send('cert-uninstall');
});

// Tabs Switching
tabModels.addEventListener('click', () => switchTab('models'));
tabLogs.addEventListener('click', () => switchTab('logs'));
tabPricing.addEventListener('click', () => switchTab('pricing'));

// Log search
logSearchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    currentPage = 1; // reset page
    renderLogsTable();
});

// Collapsible console logs
consoleHeader.addEventListener('click', () => {
    systemConsole.classList.toggle('expanded');
});

// ZH / EN Translation clicks
toggleZH.addEventListener('click', () => setLanguage('zh'));
toggleEN.addEventListener('click', () => setLanguage('en'));

// Light / Dark Theme click
toggleTheme.addEventListener('click', () => {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
});

// Export Logs Button
btnExportLogs.addEventListener('click', () => {
    const logFilePath = require('path').join(ipcRenderer.sendSync('get-userdata-path' || ''), 'stats.json');
    shell.showItemInFolder(logFilePath);
});

// IPC listeners from main process
ipcRenderer.on('state', (event, isInterceptMode) => {
    proxyToggle.checked = isInterceptMode;
    updateStatusLabel();
});

ipcRenderer.on('stats-updated', (event, payload) => {
    if (!payload) return;

    const { stats, trends, requests } = payload;
    trendsData = trends;
    allRequests = requests;

    // 1. Update Metrics Cards
    valReqs.textContent = stats.totalRequests;
    valTokens.textContent = stats.totalInputTokens.toLocaleString();
    
    // In/Out sub breakdown text
    const totalIn = stats.totalInputTokens - stats.totalCachedTokens;
    valTokensIn.textContent = formatCompactNumber(totalIn);
    valTokensOut.textContent = formatCompactNumber(stats.totalOutputTokens);
    
    // Set progress bar widths
    const totalSum = totalIn + stats.totalOutputTokens;
    const inPercent = totalSum > 0 ? (totalIn / totalSum * 100) : 50;
    const outPercent = 100 - inPercent;
    barTokensIn.style.width = `${inPercent}%`;
    barTokensOut.style.width = `${outPercent}%`;

    // Cache metrics card
    const hitRate = stats.totalInputTokens > 0
        ? (stats.totalCachedTokens / stats.totalInputTokens * 100)
        : 0;
    valHitRate.textContent = hitRate.toFixed(1) + '%';
    valCached.textContent = formatCompactNumber(stats.totalCachedTokens);
    valSavedCost.textContent = `$${(stats.totalCachedTokens * 0.3125 / 1000000).toFixed(2)}`;

    // Circle dasharray update (circumference of r=15.9155 is 100)
    gaugeCircle.setAttribute('stroke-dasharray', `${hitRate.toFixed(1)}, 100`);

    // 2. Draw SVG Area Trend line
    const filteredTrends = getFilteredTrends(trendsData, currentRange);
    drawTrendChartSVG(filteredTrends, currentRange);

    // 3. Render Model Stats Table
    modelsTableBody.innerHTML = '';
    const dict = i18n[currentLanguage];
    const modelEntries = Object.entries(stats.models);
    
    if (modelEntries.length === 0) {
        modelsTableBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-outline dark:text-outline-variant italic">${dict.noData}</td></tr>`;
    } else {
        modelEntries.forEach(([model, data]) => {
            if (model === 'unknown' && data.reqs === 0) return;
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 dark:hover:bg-white/5 transition-colors';

            const modelHitRate = data.inTokens > 0 ? (data.cachedTokens / data.inTokens * 100) : 0;
            const avgCost = data.reqs > 0 ? (data.cost / data.reqs) : 0;

            tr.innerHTML = `
                <td class="p-3 font-sans font-semibold text-on-surface dark:text-white">${model}</td>
                <td class="p-3">${data.reqs}</td>
                <td class="p-3 text-right">
                    <div class="flex flex-col items-end">
                        <span class="text-[10px] text-outline dark:text-outline-variant">${dict.input}: ${(data.inTokens - data.cachedTokens).toLocaleString()}</span>
                        <span class="text-on-surface dark:text-white">${dict.output}: ${data.outTokens.toLocaleString()}</span>
                    </div>
                </td>
                <td class="p-3">${modelHitRate.toFixed(1)}%</td>
                <td class="p-3 text-right text-primary dark:text-primary-fixed-dim font-bold">$${data.cost.toFixed(4)}</td>
                <td class="p-3 text-right text-outline dark:text-outline-variant">$${avgCost.toFixed(5)}</td>
            `;
            modelsTableBody.appendChild(tr);
        });
    }

    // 4. Render Request Logs with pagination
    renderLogsTable();
});

// Appending raw logs to console tray
ipcRenderer.on('log', (event, log) => {
    const entry = document.createElement('div');
    entry.className = 'console-entry';
    if (log.includes('⚠️')) entry.classList.add('warn');
    if (log.includes('❌')) entry.classList.add('error');
    if (log.includes('✅') || log.includes('🚀')) entry.classList.add('info');
    entry.textContent = log;
    consoleBody.appendChild(entry);
    
    // Keep max 150 console log entries
    while (consoleBody.children.length > 150) {
        consoleBody.removeChild(consoleBody.firstChild);
    }
    consoleBody.scrollTop = consoleBody.scrollHeight;
});

// CA status check
ipcRenderer.on('cert-status-res', (event, isInstalled) => {
    updateCertUI(isInstalled);
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    setTheme('dark'); // Default to dark mode (Design 4 is dark/light switchable)
    setLanguage('zh'); // Default to Chinese
    switchTab('logs'); // Default to logs tab active
    initChartFilters();
    initPricingEvents();
});

// Details Modal Elements
const detailsModal = document.getElementById('detailsModal');
const modalContainer = document.getElementById('modalContainer');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCloseBtnSecondary = document.getElementById('modalCloseBtnSecondary');
const modalCopyBtn = document.getElementById('modalCopyBtn');

const modalTime = document.getElementById('modalTime');
const modalModel = document.getElementById('modalModel');
const modalPath = document.getElementById('modalPath');
const modalTokens = document.getElementById('modalTokens');
const modalStatus = document.getElementById('modalStatus');
const modalCost = document.getElementById('modalCost');
const modalJsonArea = document.getElementById('modalJsonArea');

function hideModal() {
    detailsModal.classList.add('opacity-0', 'pointer-events-none');
    modalContainer.classList.add('scale-95');
    modalContainer.classList.remove('scale-100');
}

function showModal(log) {
    modalTime.textContent = log.timestamp || '-';
    modalModel.textContent = log.model || '-';
    modalPath.textContent = `${log.method || 'POST'} ${log.host || ''}${log.path || ''}`;
    modalCost.textContent = `$${(log.cost || 0).toFixed(6)}`;
    
    const inT = log.inTokens || 0;
    const outT = log.outTokens || 0;
    const cachedT = log.cachedTokens || 0;
    modalTokens.textContent = `In: ${inT.toLocaleString()} | Out: ${outT.toLocaleString()} | Cache: ${cachedT.toLocaleString()}`;
    
    let cacheBadge = log.cacheStatus || 'NONE';
    let statusColor = log.statusCode >= 400 ? 'text-rose-500' : 'text-emerald-500';
    modalStatus.innerHTML = `<span class="text-primary dark:text-primary-fixed-dim mr-2">${cacheBadge}</span><span class="${statusColor}">HTTP ${log.statusCode}</span>`;
    
    let formattedJson = '';
    if (log.requestBody) {
        try {
            if (typeof log.requestBody === 'object') {
                formattedJson = JSON.stringify(log.requestBody, null, 2);
            } else {
                const parsed = JSON.parse(log.requestBody);
                formattedJson = JSON.stringify(parsed, null, 2);
            }
        } catch (e) {
            formattedJson = String(log.requestBody);
        }
    } else {
        formattedJson = '{\n  "message": "无请求参数"\n}';
    }
    modalJsonArea.textContent = formattedJson;
    
    modalCopyBtn.onclick = () => {
        navigator.clipboard.writeText(formattedJson).then(() => {
            const originalText = modalCopyBtn.querySelector('span:not(.material-symbols-outlined)').textContent;
            modalCopyBtn.querySelector('span:not(.material-symbols-outlined)').textContent = currentLanguage === 'zh' ? '已复制！' : 'Copied!';
            setTimeout(() => {
                modalCopyBtn.querySelector('span:not(.material-symbols-outlined)').textContent = originalText;
            }, 1500);
        });
    };
    
    detailsModal.classList.remove('opacity-0', 'pointer-events-none');
    modalContainer.classList.remove('scale-95');
    modalContainer.classList.add('scale-100');
}

modalCloseBtn.addEventListener('click', hideModal);
modalCloseBtnSecondary.addEventListener('click', hideModal);
detailsModal.addEventListener('click', (e) => {
    if (e.target === detailsModal) hideModal();
});

// 辅助函数：将 trends 的时间字符串（如 "06/13 12:00"）还原为 Date 对象
function parseTrendsTime(timeStr) {
    if (!timeStr) return new Date();
    const currentYear = new Date().getFullYear();
    const parts = timeStr.split(' ');
    if (parts.length < 2) return new Date();
    const dateParts = parts[0].split('/'); // ["06", "13"]
    const timeParts = parts[1].split(':'); // ["12", "00"]
    return new Date(
        currentYear,
        parseInt(dateParts[0]) - 1,
        parseInt(dateParts[1]),
        parseInt(timeParts[0]),
        parseInt(timeParts[1] || 0)
    );
}

// 辅助函数：格式化 Date 为 trends 的时间 key "MM/DD HH:00"
function formatTrendsTime(date) {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    return `${m}/${d} ${hh}:00`;
}

// 辅助函数：生成指定小时数前的 slots 数组
function generateHourlySlots(hoursCount) {
    const slots = [];
    const now = new Date();
    const nowMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0).getTime();
    for (let i = hoursCount - 1; i >= 0; i--) {
        const t = new Date(nowMs - i * 3600 * 1000);
        slots.push(formatTrendsTime(t));
    }
    return slots;
}

// 辅助函数：生成今日 00:00 至今的小时 slots 数组
function generateTodaySlots() {
    const slots = [];
    const now = new Date();
    const currentHour = now.getHours();
    for (let h = 0; h <= currentHour; h++) {
        const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
        slots.push(formatTrendsTime(t));
    }
    return slots;
}

// 辅助函数：生成自定义时间区间的小时 slots 数组
function generateCustomSlots(startObj, endObj) {
    const slots = [];
    const startMs = new Date(startObj.getFullYear(), startObj.getMonth(), startObj.getDate(), startObj.getHours(), 0, 0, 0).getTime();
    const endMs = new Date(endObj.getFullYear(), endObj.getMonth(), endObj.getDate(), endObj.getHours(), 0, 0, 0).getTime();
    
    // 限制最大 slots 数为 30 天，防死循环
    const hoursDiff = Math.min(720, Math.ceil((endMs - startMs) / (3600 * 1000)));
    
    for (let i = 0; i <= hoursDiff; i++) {
        const t = new Date(startMs + i * 3600 * 1000);
        slots.push(formatTrendsTime(t));
    }
    return slots;
}

// 辅助函数：根据 range 过滤 trends 数组并补齐未记录小时点的空占位点，保证物理时间轴完全均匀且不发生挤压折叠
function getFilteredTrends(trends, range) {
    if (!trends) trends = [];
    
    let slots = [];
    if (range === 'today') {
        slots = generateTodaySlots();
    } else if (range === '3d') {
        slots = generateHourlySlots(72);
    } else if (range === '7d') {
        slots = generateHourlySlots(168);
    } else if (range === '30d') {
        slots = generateHourlySlots(720);
    } else if (range === 'custom') {
        if (!customStartDate || !customEndDate) {
            slots = generateHourlySlots(168); // 兜底 7d
        } else {
            slots = generateCustomSlots(customStartDate, customEndDate);
        }
    } else {
        slots = generateHourlySlots(168); // 兜底 7d
    }
    
    const result = slots.map(slot => {
        const found = trends.find(item => item.time === slot);
        if (found) {
            return found;
        } else {
            return {
                time: slot,
                input: 0,
                output: 0,
                cached: 0,
                cacheCreated: 0,
                cost: 0
            };
        }
    });
    
    return result;
}

// 趋势图筛选控制器
function initChartFilters() {
    const chartRangeSelector = document.getElementById('chartRangeSelector');
    const chartFilterPanel = document.getElementById('chartFilterPanel');
    const btnCancelFilter = document.getElementById('btnCancelFilter');
    const btnApplyFilter = document.getElementById('btnApplyFilter');
    
    const filterStartDate = document.getElementById('filterStartDate');
    const filterStartTime = document.getElementById('filterStartTime');
    const filterEndDate = document.getElementById('filterEndDate');
    const filterEndTime = document.getElementById('filterEndTime');
    
    // 给日期输入框附默认值
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    
    filterEndDate.value = now.toISOString().split('T')[0];
    filterEndTime.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    filterStartDate.value = sevenDaysAgo.toISOString().split('T')[0];
    filterStartTime.value = '00:00';
    
    const buttons = chartRangeSelector.querySelectorAll('button[data-range]');
    
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const range = btn.getAttribute('data-range');
            
            if (range === 'filter') {
                chartFilterPanel.classList.toggle('hidden');
                return;
            }
            
            chartFilterPanel.classList.add('hidden');
            currentRange = range;
            
            buttons.forEach(b => {
                if (b.getAttribute('data-range') === 'filter') {
                    b.className = 'px-2.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-md transition-all font-medium flex items-center gap-0.5';
                    return;
                }
                
                if (b === btn) {
                    b.className = 'px-2.5 py-0.5 text-[10px] bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim rounded-md shadow-sm font-semibold';
                } else {
                    b.className = 'px-2.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-md transition-all font-medium';
                }
            });
            
            const filtered = getFilteredTrends(trendsData, currentRange);
            drawTrendChartSVG(filtered, currentRange);
        });
    });
    
    btnCancelFilter.addEventListener('click', () => {
        chartFilterPanel.classList.add('hidden');
    });
    
    btnApplyFilter.addEventListener('click', () => {
        const startD = filterStartDate.value;
        const startT = filterStartTime.value || '00:00';
        const endD = filterEndDate.value;
        const endT = filterEndTime.value || '23:59';
        
        if (!startD || !endD) {
            alert('请选择完整的开始与结束日期');
            return;
        }
        
        customStartDate = new Date(`${startD}T${startT}`);
        customEndDate = new Date(`${endD}T${endT}`);
        
        if (customStartDate > customEndDate) {
            alert('开始时间不能晚于结束时间');
            return;
        }
        
        currentRange = 'custom';
        
        buttons.forEach(b => {
            if (b.getAttribute('data-range') === 'filter') {
                b.className = 'px-2.5 py-0.5 text-[10px] bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim rounded-md shadow-sm font-semibold flex items-center gap-0.5';
            } else {
                b.className = 'px-2.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-md transition-all font-medium';
            }
        });
        
        chartFilterPanel.classList.add('hidden');
        
        const filtered = getFilteredTrends(trendsData, currentRange);
        drawTrendChartSVG(filtered, currentRange);
    });
}

// Pricing Management
function fetchPricing() {
    ipcRenderer.send('get-pricing');
}

function renderPricingTable() {
    pricingTableBody.innerHTML = '';
    
    const list = Object.entries(pricingConfig);
    
    if (list.length === 0) {
        pricingTableBody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-outline">暂无模型配置</td></tr>`;
        return;
    }
    
    list.forEach(([key, val]) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors border-b border-outline-variant/10';
        
        const isUnknown = key === 'unknown';
        const modelLabel = isUnknown ? '<span class="text-outline">默认回退模型 (unknown)</span>' : key;
        
        tr.innerHTML = `
            <td class="p-3 pl-5 font-bold text-on-surface dark:text-white flex items-center gap-2 h-12">
                <span class="material-symbols-outlined text-[16px] text-primary">analytics</span>
                <span>${modelLabel}</span>
            </td>
            <td class="p-3 text-right text-slate-600 dark:text-slate-300 font-data-mono">$${val.input.toFixed(6)}</td>
            <td class="p-3 text-right text-slate-600 dark:text-slate-300 font-data-mono">$${val.output.toFixed(6)}</td>
            <td class="p-3 text-right text-slate-600 dark:text-slate-300 font-data-mono">$${val.cached.toFixed(6)}</td>
            <td class="p-3 text-center">
                <div class="flex justify-center gap-2">
                    <button class="btn-edit-pricing text-primary hover:underline text-[12px] font-bold" data-key="${key}">编辑</button>
                    ${isUnknown ? '' : `<button class="btn-delete-pricing text-red-500 hover:underline text-[12px] font-bold" data-key="${key}">删除</button>`}
                </div>
            </td>
        `;
        pricingTableBody.appendChild(tr);
    });
    
    // Bind buttons in table
    pricingTableBody.querySelectorAll('.btn-edit-pricing').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-key');
            showPricingModal(key, pricingConfig[key]);
        });
    });
    
    pricingTableBody.querySelectorAll('.btn-delete-pricing').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-key');
            if (confirm(`确定要删除模型 "${key}" 的自定义计费配置吗？`)) {
                ipcRenderer.send('delete-pricing', key);
            }
        });
    });
}

// Pricing Modal controls
const pricingModal = document.getElementById('pricingModal');
const pricingModalContainer = document.getElementById('pricingModalContainer');
const pricingModalTitle = document.getElementById('pricingModalTitle');
const pricingModalCloseBtn = document.getElementById('pricingModalCloseBtn');
const pricingModalCancelBtn = document.getElementById('pricingModalCancelBtn');
const pricingModalSaveBtn = document.getElementById('pricingModalSaveBtn');
const pricingForm = document.getElementById('pricingForm');

const pricingModelName = document.getElementById('pricingModelName');
const pricingInputVal = document.getElementById('pricingInputVal');
const pricingOutputVal = document.getElementById('pricingOutputVal');
const pricingCachedVal = document.getElementById('pricingCachedVal');
const pricingOrigKey = document.getElementById('pricingOrigKey');

function showPricingModal(modelKey = '', pricingData = null) {
    if (modelKey) {
        pricingModalTitle.textContent = '编辑模型计费配置';
        pricingOrigKey.value = modelKey;
        pricingModelName.value = modelKey;
        if (modelKey === 'unknown') {
            pricingModelName.disabled = true;
        } else {
            pricingModelName.disabled = false;
        }
        
        pricingInputVal.value = pricingData.input;
        pricingOutputVal.value = pricingData.output;
        pricingCachedVal.value = pricingData.cached;
    } else {
        pricingModalTitle.textContent = '新增模型计费配置';
        pricingOrigKey.value = '';
        pricingModelName.value = '';
        pricingModelName.disabled = false;
        
        pricingInputVal.value = '0.0';
        pricingOutputVal.value = '0.0';
        pricingCachedVal.value = '0.0';
    }
    
    pricingModal.classList.remove('opacity-0', 'pointer-events-none');
    pricingModalContainer.classList.remove('scale-95');
    pricingModalContainer.classList.add('scale-100');
}

function hidePricingModal() {
    pricingModal.classList.add('opacity-0', 'pointer-events-none');
    pricingModalContainer.classList.add('scale-95');
    pricingModalContainer.classList.remove('scale-100');
}

function initPricingEvents() {
    const btnResetPricing = document.getElementById('btnResetPricing');
    const btnAddPricing = document.getElementById('btnAddPricing');
    
    btnAddPricing.addEventListener('click', () => showPricingModal());
    
    btnResetPricing.addEventListener('click', () => {
        if (confirm('确定要恢复默认的模型计费配置吗？这会清除所有自定义修改！')) {
            ipcRenderer.send('reset-pricing');
        }
    });
    
    // Modal buttons
    pricingModalCloseBtn.addEventListener('click', hidePricingModal);
    pricingModalCancelBtn.addEventListener('click', hidePricingModal);
    
    pricingModalSaveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        
        const modelName = pricingModelName.value.trim().toLowerCase();
        if (!modelName) {
            alert('请输入模型匹配名称');
            return;
        }
        
        const inputVal = parseFloat(pricingInputVal.value);
        const outputVal = parseFloat(pricingOutputVal.value);
        const cachedVal = parseFloat(pricingCachedVal.value);
        
        if (isNaN(inputVal) || isNaN(outputVal) || isNaN(cachedVal) || inputVal < 0 || outputVal < 0 || cachedVal < 0) {
            alert('请输入有效的正数价格');
            return;
        }
        
        const origKey = pricingOrigKey.value;
        if (origKey && origKey !== modelName) {
            ipcRenderer.send('delete-pricing', origKey);
        }
        
        ipcRenderer.send('update-pricing', modelName, {
            input: inputVal,
            output: outputVal,
            cached: cachedVal
        });
        
        hidePricingModal();
    });
    
    // Register IPC reply handler
    ipcRenderer.on('get-pricing-res', (event, pricing) => {
        pricingConfig = pricing;
        renderPricingTable();
    });
    
    // Initial fetch
    fetchPricing();
}

// --- Account Management UI ---

function switchView(viewName) {
    const viewDashboard = document.getElementById('view-dashboard');
    const viewAccounts = document.getElementById('view-accounts');
    const viewSettings = document.getElementById('view-settings');
    const navDashboard = document.getElementById('nav-dashboard');
    const navAccounts = document.getElementById('nav-accounts');
    const navSettings = document.getElementById('nav-settings');

    if (!viewDashboard || !viewAccounts || !viewSettings || !navDashboard || !navAccounts || !navSettings) {
        console.warn('[switchView] Warning: DOM navigation or view elements not found:', {
            viewDashboard: !viewDashboard ? 'MISSING' : 'OK',
            viewAccounts: !viewAccounts ? 'MISSING' : 'OK',
            viewSettings: !viewSettings ? 'MISSING' : 'OK',
            navDashboard: !navDashboard ? 'MISSING' : 'OK',
            navAccounts: !navAccounts ? 'MISSING' : 'OK',
            navSettings: !navSettings ? 'MISSING' : 'OK'
        });
        return;
    }

    if (viewName === 'dashboard') {
        viewDashboard.classList.remove('hidden');
        viewAccounts.classList.add('hidden');
        viewSettings.classList.add('hidden');
        navDashboard.classList.add('border-b-2', 'border-primary');
        navDashboard.classList.remove('text-outline');
        navDashboard.classList.add('text-primary', 'dark:text-primary-fixed-dim');
        
        navAccounts.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navAccounts.classList.add('text-outline');
        navSettings.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navSettings.classList.add('text-outline');
    } else if (viewName === 'accounts') {
        viewDashboard.classList.add('hidden');
        viewAccounts.classList.remove('hidden');
        viewAccounts.classList.add('flex');
        viewSettings.classList.add('hidden');
        
        navAccounts.classList.add('border-b-2', 'border-primary');
        navAccounts.classList.remove('text-outline');
        navAccounts.classList.add('text-primary', 'dark:text-primary-fixed-dim');
        
        navDashboard.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navDashboard.classList.add('text-outline');
        navSettings.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navSettings.classList.add('text-outline');
    } else if (viewName === 'settings') {
        viewDashboard.classList.add('hidden');
        viewAccounts.classList.add('hidden');
        viewSettings.classList.remove('hidden');
        viewSettings.classList.add('flex');
        
        navSettings.classList.add('border-b-2', 'border-primary');
        navSettings.classList.remove('text-outline');
        navSettings.classList.add('text-primary', 'dark:text-primary-fixed-dim');
        
        navDashboard.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navDashboard.classList.add('text-outline');
        navAccounts.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navAccounts.classList.add('text-outline');

        // Fetch directory paths when settings tab is selected
        refreshDataDir();
    }
}

// Ensure globally accessible
window.switchView = switchView;

const btnAddAccount = document.getElementById('btnAddAccount');
const addAccountDropdown = document.getElementById('addAccountDropdown');
const poolModeToggle = document.getElementById('poolModeToggle');
const accountsList = document.getElementById('accountsList');
const accountsEmptyState = document.getElementById('accountsEmptyState');
const accountCountBadge = document.getElementById('accountCountBadge');
const btnRefreshAllQuota = document.getElementById('btnRefreshAllQuota');
const btnRefreshAllIcon = document.getElementById('btnRefreshAllIcon');

let isRefreshingAll = false;

/**
 * 一键刷新所有账号配额
 * 依次遍历所有账号卡片中的刷新按钮并触发刷新
 */
async function refreshAllQuotas() {
    if (isRefreshingAll) return;
    isRefreshingAll = true;

    // 旋转图标动画
    btnRefreshAllIcon.classList.add('animate-spin');
    btnRefreshAllQuota.disabled = true;
    btnRefreshAllQuota.classList.add('opacity-60', 'cursor-not-allowed');

    try {
        // 取得所有账号卡片内的刷新按钮（每张卡片各自的刷新图标按钮）
        const cardRefreshBtns = accountsList.querySelectorAll('[data-quota-refresh-btn]');
        if (cardRefreshBtns.length === 0) {
            // 如果卡片还未渲染，直接清除 quotaCache 并强制重绘
            quotaCache = {};
            const accounts = await ipcRenderer.invoke('accounts:list');
            renderAccounts(accounts);
        } else {
            // 串行逐一点击每张卡片的刷新按钮（避免同时发起大量请求）
            for (const btn of cardRefreshBtns) {
                btn.click();
                await new Promise(r => setTimeout(r, 200));
            }
        }
    } finally {
        // 延迟一点恢复，让用户能看到旋转效果
        await new Promise(r => setTimeout(r, 800));
        btnRefreshAllIcon.classList.remove('animate-spin');
        btnRefreshAllQuota.disabled = false;
        btnRefreshAllQuota.classList.remove('opacity-60', 'cursor-not-allowed');
        isRefreshingAll = false;
    }
}

btnRefreshAllQuota.addEventListener('click', refreshAllQuotas);


let isLoadingAuth = false;

// 切换下拉菜单
btnAddAccount.addEventListener('click', () => {
    if (isLoadingAuth) return;
    addAccountDropdown.classList.toggle('hidden');
});

// 点击外部关闭下拉菜单
document.addEventListener('click', (e) => {
    if (!btnAddAccount.contains(e.target) && !addAccountDropdown.contains(e.target)) {
        addAccountDropdown.classList.add('hidden');
    }
});

// 暴露到全局以便 onclick 调用
window.startLogin = async function(provider) {
    if (isLoadingAuth) return;
    isLoadingAuth = true;
    addAccountDropdown.classList.add('hidden');

    const origText = btnAddAccount.innerHTML;
    btnAddAccount.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span> 登录中...';
    btnAddAccount.classList.add('opacity-70', 'cursor-not-allowed');

    try {
        const res = await ipcRenderer.invoke('auth:login', provider);
        if (!res.success) {
            alert('登录失败或已取消: ' + res.error);
        }
    } catch (err) {
        alert('登录出错: ' + err.message);
    } finally {
        isLoadingAuth = false;
        btnAddAccount.innerHTML = origText;
        btnAddAccount.classList.remove('opacity-70', 'cursor-not-allowed');
    }
};

poolModeToggle.addEventListener('change', (e) => {
    ipcRenderer.send('pool:toggle', e.target.checked);
});

function getRelativeResetTime(resetTime) {
    try {
        const now = Date.now();
        const reset = new Date(resetTime).getTime();
        const diffMs = reset - now;
        if (diffMs <= 0) {
            return '已重置';
        }
        const diffMins = Math.round(diffMs / 60000);
        if (diffMins < 60) {
            return `将在 ${diffMins} 分钟后重置`;
        }
        const diffHours = Math.floor(diffMins / 60);
        const remMins = diffMins % 60;
        if (diffHours < 24) {
            return `将在 ${diffHours} 小时 ${remMins} 分钟后重置`;
        }
        const diffDays = Math.floor(diffHours / 24);
        const remHours = diffHours % 24;
        return `将在 ${diffDays} 天 ${remHours} 小时后重置`;
    } catch (e) {
        return `重置时间: ${new Date(resetTime).toLocaleString()}`;
    }
}

function renderQuotaBars(containerEl, buckets) {
    containerEl.innerHTML = '';
    if (!buckets || buckets.length === 0) {
        containerEl.innerHTML = '<span class="text-[10px] text-outline/50 italic">暂无配额数据</span>';
        return;
    }

    // 检查是否包含分组信息
    const hasGroups = buckets.some(b => b.group);

    if (hasGroups) {
        // 按组归类
        const groups = {};
        buckets.forEach(b => {
            const groupName = b.group || '其他模型';
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push(b);
        });

        // 渲染分组容器
        Object.keys(groups).forEach((groupName, idx) => {
            const groupBuckets = groups[groupName];
            
            const groupContainer = document.createElement('div');
            // 如果不是第一个组，增加顶部间距
            groupContainer.className = `flex flex-col gap-2 bg-[#f8fafc]/60 dark:bg-[#20293d]/30 border border-slate-100 dark:border-slate-800/30 rounded-lg p-2.5 ${idx > 0 ? 'mt-2' : 'mt-1'}`;
            
            const groupTitle = document.createElement('div');
            groupTitle.className = 'text-[10px] font-bold text-on-surface dark:text-white flex items-center gap-1.5 border-b border-outline-variant/10 pb-1.5 mb-1';
            groupTitle.innerHTML = `
                <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                <span>${groupName}</span>
            `;
            groupContainer.appendChild(groupTitle);

            groupBuckets.forEach(b => {
                const pct = b.remainPercent;
                const barColor = pct > 50
                    ? 'bg-emerald-500'
                    : pct > 20
                        ? 'bg-amber-400'
                        : 'bg-red-500';

                const resetStr = b.resetTime
                    ? getRelativeResetTime(b.resetTime)
                    : null;

                const row = document.createElement('div');
                row.className = 'flex flex-col gap-0.5 mt-1';
                row.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span class="text-[10px] text-outline dark:text-outline-variant truncate max-w-[70%]" title="${b.modelId}">${b.modelId}</span>
                        <span class="text-[10px] font-bold text-on-surface dark:text-white">${pct}%</span>
                    </div>
                    <div class="h-1.5 bg-outline-variant/20 dark:bg-white/10 rounded-full overflow-hidden">
                        <div class="h-full ${barColor} rounded-full transition-all duration-700"
                             style="width: ${pct}%"></div>
                    </div>
                    ${resetStr ? `<span class="text-[9px] text-outline/50 mt-0.5">${resetStr}</span>` : ''}
                `;
                groupContainer.appendChild(row);
            });

            containerEl.appendChild(groupContainer);
        });
    } else {
        // 兼容原有的平铺渲染方式
        buckets.forEach(b => {
            const pct = b.remainPercent;
            const barColor = pct > 50
                ? 'bg-emerald-500'
                : pct > 20
                    ? 'bg-amber-400'
                    : 'bg-red-500';

            const resetStr = b.resetTime
                ? new Date(b.resetTime).toLocaleString()
                : null;

            const row = document.createElement('div');
            row.className = 'flex flex-col gap-0.5';
            row.innerHTML = `
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-outline dark:text-outline-variant truncate max-w-[70%]" title="${b.modelId}">${b.modelId}</span>
                    <span class="text-[10px] font-bold text-on-surface dark:text-white">${pct}%</span>
                </div>
                <div class="h-1.5 bg-outline-variant/20 dark:bg-white/10 rounded-full overflow-hidden">
                    <div class="h-full ${barColor} rounded-full transition-all duration-700"
                         style="width: ${pct}%"></div>
                </div>
                ${resetStr ? `<span class="text-[9px] text-outline/50 mt-0.5">重置于: ${resetStr}</span>` : ''}
            `;
            containerEl.appendChild(row);
        });
    }
}

async function loadAccountQuota(accountId, containerEl, refreshBtn, force = false) {
    if (!force && quotaCache[accountId]) {
        renderQuotaBars(containerEl, quotaCache[accountId]);
        return;
    }
    refreshBtn.classList.add('animate-spin');
    containerEl.innerHTML = '<span class="text-[10px] text-outline/50">加载中...</span>';
    try {
        const result = await ipcRenderer.invoke('quota:fetch', accountId);
        if (result.error) {
            containerEl.innerHTML = `<span class="text-[10px] text-red-400">${result.error}</span>`;
        } else {
            quotaCache[accountId] = result.buckets;
            renderQuotaBars(containerEl, result.buckets);
        }
    } catch (e) {
        containerEl.innerHTML = `<span class="text-[10px] text-red-400">请求失败</span>`;
    } finally {
        refreshBtn.classList.remove('animate-spin');
    }
}

function renderAccounts(accounts) {
    accountCountBadge.textContent = `共 ${accounts.length} 个账号`;
    accountsList.innerHTML = '';
    
    if (accounts.length === 0) {
        accountsEmptyState.classList.remove('hidden');
        accountsEmptyState.classList.add('flex');
        accountsList.classList.add('hidden');
        return;
    }
    
    accountsEmptyState.classList.add('hidden');
    accountsEmptyState.classList.remove('flex');
    accountsList.classList.remove('hidden');
    
    accounts.forEach(acc => {
        const card = document.createElement('div');
        card.className = 'bg-white dark:bg-[#1a1f30] border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-3 shadow-sm relative overflow-hidden';
        
        // Background decorative icon
        const bgIcon = document.createElement('div');
        bgIcon.className = 'absolute -right-4 -bottom-4 text-primary opacity-[0.03] pointer-events-none';
        bgIcon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 80px;">account_circle</span>';
        card.appendChild(bgIcon);
        
        // ---- Header ----
        const header = document.createElement('div');
        header.className = 'flex justify-between items-start';

        const info = document.createElement('div');
        info.className = 'flex flex-col flex-1 min-w-0 mr-2';

        // 增加提供商 Badge
        const providerBadge = acc.provider === 'antigravity'
            ? '<span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold border border-primary/20 ml-2 mt-0.5 self-center">Antigravity</span>'
            : (acc.provider === 'gemini-cli'
                ? '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300 text-[9px] font-bold border border-outline-variant/30 ml-2 mt-0.5 self-center">Gemini CLI</span>'
                : '');

        info.innerHTML = `
            <div class="flex items-center">
                <span class="text-[13px] font-bold text-on-surface dark:text-white truncate" title="${acc.email}">${acc.email}</span>
                ${providerBadge}
            </div>
            <span class="text-[11px] text-outline mt-0.5 truncate">添加于: ${new Date(acc.addedAt).toLocaleString()}</span>
        `;
        
        const statusBadge = document.createElement('div');
        statusBadge.className = 'flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded text-nowrap self-start flex-shrink-0';
        statusBadge.innerHTML = '<span class="material-symbols-outlined text-[12px]">check_circle</span> 有效';
        
        header.appendChild(info);
        header.appendChild(statusBadge);
        
        // ---- Quota Section ----
        const quotaSection = document.createElement('div');
        quotaSection.className = 'flex flex-col gap-2 border-t border-outline-variant/20 pt-3';

        const quotaHeader = document.createElement('div');
        quotaHeader.className = 'flex justify-between items-center';
        quotaHeader.innerHTML = '<span class="text-[11px] font-semibold text-outline dark:text-outline-variant">剩余配额</span>';

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'text-outline hover:text-primary transition-colors z-10';
        refreshBtn.title = '刷新配额';
        refreshBtn.setAttribute('data-quota-refresh-btn', '');
        refreshBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">refresh</span>';

        quotaHeader.appendChild(refreshBtn);
        quotaSection.appendChild(quotaHeader);

        const quotaBars = document.createElement('div');
        quotaBars.className = 'flex flex-col gap-2';
        quotaSection.appendChild(quotaBars);

        // Bind refresh button
        refreshBtn.onclick = () => loadAccountQuota(acc.id, quotaBars, refreshBtn, true);

        // ---- Footer ----
        const footer = document.createElement('div');
        footer.className = 'flex justify-end pt-1 border-t border-outline-variant/20';
        
        const btnDelete = document.createElement('button');
        btnDelete.className = 'text-[11px] font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded transition-colors flex items-center gap-1 z-10';
        btnDelete.innerHTML = '<span class="material-symbols-outlined text-[14px]">delete</span> 移除';
        btnDelete.onclick = () => {
            if (confirm(`确定要移除账号 ${acc.email} 吗？`)) {
                ipcRenderer.send('accounts:remove', acc.id);
            }
        };
        
        footer.appendChild(btnDelete);
        
        card.appendChild(header);
        card.appendChild(quotaSection);
        card.appendChild(footer);
        accountsList.appendChild(card);

        // Auto-load quota on render
        loadAccountQuota(acc.id, quotaBars, refreshBtn, false);
    });
}

ipcRenderer.on('accounts-res', (event, data) => {
    if (data.accounts) {
        renderAccounts(data.accounts);
    }
    if (typeof data.poolMode !== 'undefined') {
        poolModeToggle.checked = data.poolMode;
    }
});

// Fetch initial accounts
ipcRenderer.send('accounts:get');

// --- Settings Management UI ---
const txtDataDir = document.getElementById('txtDataDir');
const btnBrowseDir = document.getElementById('btnBrowseDir');
const migrationStatus = document.getElementById('migrationStatus');
const migrationStatusMsg = document.getElementById('migrationStatusMsg');

function refreshDataDir() {
    try {
        const res = ipcRenderer.sendSync('settings:get-dir-sync');
        if (res && res.activeDir) {
            txtDataDir.value = res.activeDir;
        }
    } catch (err) {
        console.error('Failed to get data directory:', err);
    }
}

// Ensure globally accessible
window.refreshDataDir = refreshDataDir;

btnBrowseDir.addEventListener('click', async () => {
    migrationStatus.classList.add('hidden');
    migrationStatusMsg.innerText = '';
    
    btnBrowseDir.disabled = true;
    
    try {
        const result = await ipcRenderer.invoke('settings:change-dir');
        if (result.success) {
            if (result.activeDir) {
                txtDataDir.value = result.activeDir;
            }
        } else if (result.error && result.error !== '用户取消选择') {
            showMigrationError(result.error);
        }
    } catch (err) {
        showMigrationError(err.message);
    } finally {
        btnBrowseDir.disabled = false;
    }
});

function showMigrationError(errText) {
    migrationStatus.classList.remove('hidden');
    migrationStatus.className = 'text-[12px] p-3 rounded-lg border bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900/30 flex flex-col gap-1';
    
    const isZH = typeof currentLang !== 'undefined' ? currentLang === 'zh' : true;
    const prefix = isZH ? '❌ 迁移失败：' : '❌ Migration failed: ';
    migrationStatusMsg.innerText = prefix + errText;
    migrationStatusMsg.className = 'text-[12px] text-rose-600 dark:text-rose-400 mt-1 font-medium';
}

ipcRenderer.on('settings:migration-progress', (event, data) => {
    migrationStatus.classList.remove('hidden');
    const isZH = typeof currentLang !== 'undefined' ? currentLang === 'zh' : true;

    if (data.step === 'error') {
        showMigrationError(data.status);
    } else if (data.step === 'success') {
        migrationStatus.className = 'text-[12px] p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/30 flex flex-col gap-1';
        migrationStatusMsg.innerText = isZH ? '🎉 数据迁移成功！已重定向至新存储路径。' : '🎉 Migration completed successfully! Redirected to the new path.';
        migrationStatusMsg.className = 'text-[12px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium';
    } else {
        migrationStatus.className = 'text-[12px] p-3 rounded-lg border bg-slate-50 dark:bg-white/5 border-outline-variant/30 flex flex-col gap-1';
        
        let statusText = data.status;
        if (!isZH) {
            if (data.step === 'stop-proxy') statusText = 'Stopping proxy server...';
            else if (data.step === 'migrate-files') statusText = 'Migrating data files and certificates (Do not close)...';
            else if (data.step === 'update-paths') statusText = 'Redirecting internal path services...';
            else if (data.step === 'patch-externals') statusText = 'Updating external settings and certificate patches...';
            else if (data.step === 'restart-proxy') statusText = 'Restarting proxy server...';
        }
        
        migrationStatusMsg.innerText = statusText;
        migrationStatusMsg.className = 'text-[12px] text-outline mt-1 font-medium';
    }
});

