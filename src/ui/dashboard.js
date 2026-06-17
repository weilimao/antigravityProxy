/**
 * Antigravity Proxy - Frontend Renderer Controller
 */

const { ipcRenderer, shell } = require('electron');
const i18n = require('./src/shared/i18n');
const usageDetails = require('./src/ui/usageDetails');

// State Variables
let currentLanguage = 'zh';
let currentTheme = 'light';
let activeTab = 'logs'; // Default to logs in Design 4
let trendsData = [];
let allRequests = [];
let searchQuery = '';
let currentRange = '24h';
let customStartDate = null;
let customEndDate = null;
let quotaCache = {}; // Cache for account quota buckets: { accountId: buckets }
let currentAccountsList = []; // Track currently loaded accounts for aggregation
let currentActiveChannel = 'antigravity'; // Active routing channel: 'antigravity' or 'project'
let lastBackendData = null; // Last fetched accounts payload
let currentViewTab = ''; // Currently selected accounts view tab: 'antigravity' or 'project'
let memoryHistory = [];
const maxMemoryHistoryPoints = 25;

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
let certStatusRetryTimer = null;

// Metrics Cards
const valReqs = document.getElementById('valReqs');
const valTokens = document.getElementById('valTokens');
const valTokensIn = document.getElementById('valTokensIn');
const valTokensOut = document.getElementById('valTokensOut');
const valCached = document.getElementById('valCached');
const valSavedCost = document.getElementById('valSavedCost');
const valTotalCost = document.getElementById('valTotalCost');
const valHitRate = document.getElementById('valHitRate');
const gaugeCircle = document.getElementById('gaugeCircle');
const barTokensIn = document.getElementById('barTokensIn');
const barTokensOut = document.getElementById('barTokensOut');

const valRetries = document.getElementById('valRetries');
const valErrors = document.getElementById('valErrors');
const barSuccess = document.getElementById('barSuccess');
const barErrors = document.getElementById('barErrors');
const valSuccessRate = document.getElementById('valSuccessRate');

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

usageDetails.init();

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

// Render Memory Usage Chart
function updateMemoryChart() {
    const svg = document.getElementById('memorySvg');
    const path = document.getElementById('memoryChartPath');
    const area = document.getElementById('memoryChartArea');
    const dot = document.getElementById('memoryChartDot');
    if (!svg || !path || !area || memoryHistory.length === 0) return;

    const width = 200;
    const height = 45;
    const padding = 4; // Padding to keep line and dot within bounds

    const N = memoryHistory.length;
    let minVal = Math.min(...memoryHistory);
    let maxVal = Math.max(...memoryHistory);

    // Dynamic scaling logic
    if (maxVal - minVal < 5.0) {
        const center = (maxVal + minVal) / 2;
        minVal = Math.max(0, center - 2.5);
        maxVal = center + 2.5;
    } else {
        const diff = maxVal - minVal;
        minVal = Math.max(0, minVal - diff * 0.1);
        maxVal = maxVal + diff * 0.1;
    }

    const points = memoryHistory.map((val, idx) => {
        const x = N > 1 ? (idx / (N - 1)) * width : width / 2;
        const y = height - padding - ((val - minVal) / (maxVal - minVal)) * (height - 2 * padding);
        return { x, y };
    });

    let d = '';
    if (points.length === 1) {
        d = `M 0,${points[0].y} L ${width},${points[0].y}`;
    } else {
        d = getBezierPath(points);
    }

    path.setAttribute('d', d);

    if (points.length > 0) {
        const areaD = `${d} L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;
        area.setAttribute('d', areaD);
    }

    if (dot && points.length > 0) {
        const lastPoint = points[points.length - 1];
        dot.setAttribute('cx', lastPoint.x.toFixed(1));
        dot.setAttribute('cy', lastPoint.y.toFixed(1));
    }
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

    // Calculate total summary stats for the filtered trends
    let totalCostVal = 0;
    let totalInputCostVal = 0;
    let totalOutputCostVal = 0;
    let totalCachedCostVal = 0;

    trends.forEach(bin => {
        const binCost = bin.cost || 0;
        let binInputCost = bin.inputCost;
        let binOutputCost = bin.outputCost;
        let binCachedCost = bin.cachedCost;

        if (binInputCost === undefined || binOutputCost === undefined || binCachedCost === undefined) {
            // Estimate using default rates (Gemini 3.5 Flash)
            const inputTokens = bin.input || 0;
            const outputTokens = bin.output || 0;
            const cachedTokens = bin.cached || 0;
            const nonCachedIn = Math.max(0, inputTokens - cachedTokens);

            const estInput = nonCachedIn * 1.50 / 1000000;
            const estOutput = outputTokens * 9.00 / 1000000;
            const estCached = cachedTokens * 0.375 / 1000000;
            const estTotal = estInput + estOutput + estCached;

            if (estTotal > 0) {
                binInputCost = binCost * (estInput / estTotal);
                binOutputCost = binCost * (estOutput / estTotal);
                binCachedCost = binCost * (estCached / estTotal);
            } else {
                binInputCost = 0;
                binOutputCost = 0;
                binCachedCost = 0;
            }
        }

        totalCostVal += binCost;
        totalInputCostVal += binInputCost;
        totalOutputCostVal += binOutputCost;
        totalCachedCostVal += binCachedCost;
    });

    const labelSummaryTotal = document.getElementById('labelSummaryTotal');
    const valSummaryTotal = document.getElementById('valSummaryTotal');
    const valSummaryInput = document.getElementById('valSummaryInput');
    const valSummaryOutput = document.getElementById('valSummaryOutput');
    const valSummaryCached = document.getElementById('valSummaryCached');

    if (labelSummaryTotal) {
        const dict = i18n[currentLanguage] || {};
        let labelKey = 'summaryTotalCostCustom';
        if (range === 'today') labelKey = 'summaryTotalCostToday';
        else if (range === '24h') labelKey = 'summaryTotalCost24h';
        else if (range === '3d') labelKey = 'summaryTotalCost3d';
        else if (range === '7d') labelKey = 'summaryTotalCost7d';
        else if (range === '30d') labelKey = 'summaryTotalCost30d';
        labelSummaryTotal.textContent = dict[labelKey] || '总成本:';
    }

    if (valSummaryTotal) valSummaryTotal.textContent = `$${totalCostVal.toFixed(4)}`;
    if (valSummaryInput) valSummaryInput.textContent = `$${totalInputCostVal.toFixed(4)}`;
    if (valSummaryOutput) valSummaryOutput.textContent = `$${totalOutputCostVal.toFixed(4)}`;
    if (valSummaryCached) valSummaryCached.textContent = `$${totalCachedCostVal.toFixed(4)}`;

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
        const percent = N > 1 ? (idx / (N - 1)) * 100 : 50;
        const label = document.createElement('div');
        label.className = 'absolute -translate-x-1/2 text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap font-sans';
        label.style.left = `${percent}%`;
        
        if (range === '24h') {
            if (idx === 0) {
                label.textContent = d.time || '';
            } else {
                const prevD = trends[idx - 1];
                const currentDay = d.time ? d.time.split(' ')[0] : '';
                const prevDay = prevD && prevD.time ? prevD.time.split(' ')[0] : '';
                if (currentDay && prevDay && currentDay !== prevDay) {
                    label.textContent = d.time || '';
                } else {
                    label.textContent = d.time ? (d.time.split(' ')[1] || d.time) : '';
                }
            }
        } else if (isSingleDay) {
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
    // 同步语言到主进程托盘右键菜单
    ipcRenderer.send('settings:language-changed', lang);
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

function requestCertStatus() {
    if (certStatusRetryTimer) {
        clearTimeout(certStatusRetryTimer);
        certStatusRetryTimer = null;
    }
    try {
        ipcRenderer.send('cert-status');
        certStatusRetryTimer = setTimeout(() => {
            ipcRenderer.send('cert-status');
        }, 1200);
    } catch (e) {
        console.error('[Dashboard] Failed to request cert status:', e);
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
               (log.sessionId || '').toLowerCase().includes(q) ||
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

    logsTableBody.innerHTML = '';
    if (paginated.length === 0) {
        logsTableBody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-outline dark:text-outline-variant italic">${dict.noLogs}</td></tr>`;
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
                <td class="p-3 text-outline dark:text-outline-variant font-data-mono text-[12px] truncate" title="${log.sessionId || '-'}">${log.sessionId || '-'}</td>
                <td class="p-3 font-sans font-medium text-on-surface dark:text-white truncate" title="${log.model}">
                    <div class="flex flex-col min-w-0">
                        <span class="font-semibold text-on-surface dark:text-white truncate">${log.model}</span>
                        ${log.account ? `<span class="text-[10px] text-outline dark:text-outline-variant font-data-mono truncate mt-0.5" title="${log.account}">${log.account}</span>` : '<span class="text-[10px] text-slate-400 dark:text-slate-500 font-data-mono truncate mt-0.5">直连</span>'}
                    </div>
                </td>
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
    try {
        const dirInfo = ipcRenderer.sendSync('settings:get-dir-sync') || {};
        const activeDir = dirInfo.activeDir || ipcRenderer.sendSync('get-userdata-path') || '';
        const logFilePath = require('path').join(activeDir, 'stats.json');
        
        const fs = require('fs');
        if (!fs.existsSync(logFilePath)) {
            shell.openPath(activeDir);
        } else {
            shell.showItemInFolder(logFilePath);
        }
    } catch (err) {
        console.error('Failed to show stats.json in folder:', err);
    }
});

// IPC listeners from main process
ipcRenderer.on('state', (event, isInterceptMode) => {
    proxyToggle.checked = isInterceptMode;
    updateStatusLabel();
});

ipcRenderer.on('memory-stats-updated', (event, data) => {
    if (!data) return;
    let totalMBVal = 0;
    const valMemory = document.getElementById('valMemory');
    if (valMemory && typeof data.total === 'number') {
        totalMBVal = parseFloat((data.total / (1024 * 1024)).toFixed(1));
        valMemory.textContent = `${totalMBVal.toFixed(1)} MB`;
    }
    const valProcessCount = document.getElementById('valProcessCount');
    if (valProcessCount && typeof data.processCount === 'number') {
        valProcessCount.textContent = data.processCount;
    }

    // 更新内存历史并绘制图表
    if (typeof data.total === 'number') {
        if (memoryHistory.length === 0) {
            for (let i = 0; i < maxMemoryHistoryPoints; i++) {
                memoryHistory.push(totalMBVal);
            }
        } else {
            memoryHistory.push(totalMBVal);
            if (memoryHistory.length > maxMemoryHistoryPoints) {
                memoryHistory.shift();
            }
        }
        updateMemoryChart();
    }
});

ipcRenderer.on('stats-updated', (event, payload) => {
    if (!payload) return;

    const { stats, trends, requests, usage } = payload;
    trendsData = trends;
    allRequests = requests;

    // 1. Update Metrics Cards
    const totalRequests = (stats.totalRequests || 0) + (stats.totalErrors || 0);
    valReqs.textContent = totalRequests;
    
    if (valRetries) {
        valRetries.textContent = stats.totalRetries || 0;
    }
    if (valErrors) {
        valErrors.textContent = stats.totalErrors || 0;
    }
    
    const successRate = totalRequests > 0
        ? (stats.totalRequests / totalRequests * 100)
        : 100;
    if (valSuccessRate) {
        valSuccessRate.textContent = successRate.toFixed(1) + '%';
    }
    if (barSuccess && barErrors) {
        barSuccess.style.width = `${successRate}%`;
        barErrors.style.width = `${100 - successRate}%`;
    }

    valTokens.textContent = (stats.totalInputTokens + stats.totalOutputTokens).toLocaleString();
    
    // In/Out sub breakdown text
    const totalIn = stats.totalInputTokens - stats.totalCachedTokens;
    valTokensIn.textContent = formatCompactNumber(totalIn);
    valTokensOut.textContent = formatCompactNumber(stats.totalOutputTokens);
    if (valTotalCost) {
        valTotalCost.textContent = `$${(stats.totalCost || 0).toFixed(4)}`;
    }
    
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
    const modelEntries = Object.entries(stats.models).sort((a, b) => {
        const totalA = (a[1].inTokens || 0) + (a[1].outTokens || 0);
        const totalB = (b[1].inTokens || 0) + (b[1].outTokens || 0);
        if (totalB !== totalA) return totalB - totalA;
        return (b[1].reqs || 0) - (a[1].reqs || 0);
    });
    
    if (modelEntries.length === 0) {
        modelsTableBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-outline dark:text-outline-variant italic">${dict.noData}</td></tr>`;
    } else {
        modelEntries.forEach(([model, data]) => {
            if (model === 'unknown' && data.reqs === 0) return;
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 dark:hover:bg-white/5 transition-colors';

            const modelHitRate = data.inTokens > 0 ? (data.cachedTokens / data.inTokens * 100) : 0;
            const avgCost = data.reqs > 0 ? (data.cost / data.reqs) : 0;
            const totalTokens = data.inTokens + data.outTokens;

            tr.innerHTML = `
                <td class="p-3 font-sans font-semibold text-on-surface dark:text-white">${model}</td>
                <td class="p-3 text-right">${data.reqs}</td>
                <td class="p-3 text-right font-semibold">${totalTokens.toLocaleString()}</td>
                <td class="p-3 text-right text-outline dark:text-outline-variant">${data.inTokens.toLocaleString()}</td>
                <td class="p-3 text-right text-on-surface dark:text-white">${data.outTokens.toLocaleString()}</td>
                <td class="p-3 text-right">${modelHitRate.toFixed(1)}%</td>
                <td class="p-3 text-right text-primary dark:text-primary-fixed-dim font-bold">$${data.cost.toFixed(4)}</td>
                <td class="p-3 text-right text-outline dark:text-outline-variant">$${avgCost.toFixed(5)}</td>
            `;
            modelsTableBody.appendChild(tr);
        });
    }

    // 4. Render Request Logs with pagination
    renderLogsTable();
    usageDetails.render(usage);
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
    if (certStatusRetryTimer) {
        clearTimeout(certStatusRetryTimer);
        certStatusRetryTimer = null;
    }
    updateCertUI(isInstalled);
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    setTheme('light'); // Default to light mode (Design 4 is dark/light switchable)
    setLanguage('zh'); // Default to Chinese
    switchTab('logs'); // Default to logs tab active
    initChartFilters();
    initPricingEvents();
    initAppVersion();
    requestCertStatus();
});

// Details Modal Elements
const detailsModal = document.getElementById('detailsModal');
const modalContainer = document.getElementById('modalContainer');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCloseBtnSecondary = document.getElementById('modalCloseBtnSecondary');
const modalCopyBtn = document.getElementById('modalCopyBtn');

const modalTime = document.getElementById('modalTime');
const modalSession = document.getElementById('modalSession');
const modalModel = document.getElementById('modalModel');
const modalPath = document.getElementById('modalPath');
const modalTokens = document.getElementById('modalTokens');
const modalStatus = document.getElementById('modalStatus');
const modalCost = document.getElementById('modalCost');
const modalAccount = document.getElementById('modalAccount');
const modalAccountWrapper = document.getElementById('modalAccountWrapper');
const modalJsonArea = document.getElementById('modalJsonArea');
const modalHeaderArea = document.getElementById('modalHeaderArea');
const modalCopyHeadersBtn = document.getElementById('modalCopyHeadersBtn');

function hideModal() {
    detailsModal.classList.add('opacity-0', 'pointer-events-none');
    modalContainer.classList.add('scale-95');
    modalContainer.classList.remove('scale-100');
}

function showModal(log) {
    modalTime.textContent = log.timestamp || '-';
    modalSession.textContent = log.sessionId || '-';
    modalModel.textContent = log.model || '-';
    modalPath.textContent = `${log.method || 'POST'} ${log.host || ''}${log.path || ''}`;
    modalCost.textContent = `$${(log.cost || 0).toFixed(6)}`;
    
    if (log.account) {
        modalAccountWrapper.classList.remove('hidden');
        modalAccount.textContent = log.account;
    } else {
        modalAccountWrapper.classList.add('hidden');
    }
    
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

    // 渲染请求头 JSON
    let formattedHeaders = '';
    if (log.requestHeaders) {
        try {
            formattedHeaders = JSON.stringify(log.requestHeaders, null, 2);
        } catch (e) {
            formattedHeaders = String(log.requestHeaders);
        }
    } else {
        formattedHeaders = '{\n  "message": "无请求头数据"\n}';
    }
    modalHeaderArea.textContent = formattedHeaders;

    modalCopyHeadersBtn.onclick = () => {
        navigator.clipboard.writeText(formattedHeaders).then(() => {
            const span = modalCopyHeadersBtn.querySelector('span:not(.material-symbols-outlined)');
            span.textContent = currentLanguage === 'zh' ? '已复制！' : 'Copied!';
            setTimeout(() => { span.textContent = '复制'; }, 1500);
        });
    };

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
    } else if (range === '24h') {
        slots = generateHourlySlots(24);
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
        
        updateAggregateQuotaUI();
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
const btnClearSessions = document.getElementById('btnClearSessions');
const btnRefreshAggregateQuota = document.getElementById('btnRefreshAggregateQuota');

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
if (btnRefreshAggregateQuota) {
    btnRefreshAggregateQuota.addEventListener('click', refreshAllAccountsQuotas);
}

// 清空会话绑定按钮
if (btnClearSessions) {
    btnClearSessions.addEventListener('click', async () => {
        const icon = btnClearSessions.querySelector('.material-symbols-outlined');
        const label = btnClearSessions.querySelector('span:last-child');
        const origLabel = label.textContent;
        // 加载状态
        if (icon) icon.classList.add('animate-spin');
        label.textContent = '清空中...';
        btnClearSessions.disabled = true;
        try {
            const res = await ipcRenderer.invoke('pool:clear-sessions');
            if (res && res.success) {
                label.textContent = `已清空 ${res.cleared} 条`;
                setTimeout(() => { label.textContent = origLabel; }, 2000);
            }
        } catch (err) {
            label.textContent = '清空失败';
            setTimeout(() => { label.textContent = origLabel; }, 2000);
        } finally {
            if (icon) icon.classList.remove('animate-spin');
            btnClearSessions.disabled = false;
        }
    });
}


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
        const authRequest = typeof provider === 'object' && provider !== null
            ? provider
            : { provider };
        const res = await ipcRenderer.invoke('auth:login', authRequest);
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

function showOneStopAuthModal() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[100] flex items-center justify-center transition-opacity duration-200';
        overlay.style.opacity = '0';

        const card = document.createElement('div');
        card.className = 'bg-white dark:bg-[#1e2538] w-[460px] max-w-[90vw] rounded-2xl border border-outline-variant/60 shadow-2xl p-6 flex flex-col gap-4 transform scale-95 transition-transform duration-200';

        let cachedAuthData = null;

        function cleanup(result) {
            overlay.style.opacity = '0';
            card.classList.add('scale-95');
            setTimeout(() => {
                overlay.remove();
            }, 200);
            resolve(result);
        }

        function showStep1And2() {
            card.innerHTML = `
                <div class="flex items-center gap-2 text-primary">
                    <span class="material-symbols-outlined text-[20px]">vpn_key</span>
                    <h3 class="text-base font-bold text-on-surface dark:text-white">Google Cloud 账号授权</h3>
                </div>
                
                <div class="flex flex-col gap-3.5 my-1 text-[13px] text-on-surface dark:text-white">
                    <!-- 1. OAuth Link Button -->
                    <div class="text-[12px] text-outline leading-relaxed bg-slate-50 dark:bg-white/5 p-3.5 rounded-xl border border-outline-variant/20 flex flex-col gap-2.5">
                        <p>1. 点击下方按钮复制链接并在浏览器中打开，完成 Google 账户授权：</p>
                        <button id="flowOpenAuthLink" type="button" disabled class="w-full py-2.5 bg-slate-100 dark:bg-white/5 text-outline rounded-lg transition-all font-semibold text-[12px] border border-outline-variant/20 flex items-center justify-center gap-1.5 opacity-50 cursor-not-allowed">
                            <span class="material-symbols-outlined text-[14px] animate-spin">refresh</span>
                            正在获取官方授权链接...
                        </button>
                    </div>

                    <!-- 2. Authorization Code Input -->
                    <div class="flex flex-col gap-1.5">
                        <label class="text-[11px] text-outline font-medium">2. 将网页上重定向或显示的“授权码 (Authorization Code)”粘贴在下方：</label>
                        <input type="text" id="flowAuthCodeInput" placeholder="输入以 4/ 开头的授权码..." class="w-full px-3 py-2 text-[13px] bg-slate-50 dark:bg-white/5 border border-outline-variant/30 rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface dark:text-white placeholder-outline/60" autofocus />
                    </div>
                    
                    <div id="flowError" class="text-[11px] text-red-500 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20 hidden break-all leading-normal"></div>
                </div>
                
                <div class="flex justify-end gap-2 mt-2">
                    <button id="flowCancel" type="button" class="px-4 py-1.5 text-[12px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-on-surface dark:text-white rounded-lg transition-colors border border-outline-variant/40">取消</button>
                    <button id="flowConfirm" type="button" class="px-4 py-1.5 text-[12px] font-bold bg-primary text-white hover:bg-primary/90 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1">开始登录</button>
                </div>
            `;

            const btnOpen = card.querySelector('#flowOpenAuthLink');
            const inputAuthCode = card.querySelector('#flowAuthCodeInput');
            const btnCancel = card.querySelector('#flowCancel');
            const btnConfirm = card.querySelector('#flowConfirm');
            const divError = card.querySelector('#flowError');

            setTimeout(() => inputAuthCode.focus(), 50);

            ipcRenderer.invoke('auth:get-manual-oauth-url').then((authData) => {
                if (authData && authData.url) {
                    cachedAuthData = authData;
                    btnOpen.disabled = false;
                    btnOpen.className = 'w-full py-2.5 bg-primary/10 hover:bg-primary/20 text-primary hover:text-primary rounded-lg transition-all font-semibold text-[12px] border border-primary/20 flex items-center justify-center gap-1.5 cursor-pointer';
                    btnOpen.innerHTML = '<span class="material-symbols-outlined text-[14px]">open_in_new</span> 复制链接并打开浏览器';
                } else {
                    btnOpen.innerHTML = '获取授权链接失败，请重试';
                }
            }).catch((err) => {
                btnOpen.innerHTML = '获取授权链接错误: ' + err.message;
            });

            btnOpen.addEventListener('click', () => {
                if (!cachedAuthData) return;
                navigator.clipboard.writeText(cachedAuthData.url).then(() => {
                    const origText = btnOpen.innerHTML;
                    btnOpen.innerHTML = '<span class="material-symbols-outlined text-[14px]">done</span> 已复制链接并打开浏览器';
                    setTimeout(() => {
                        btnOpen.innerHTML = origText;
                    }, 2000);
                }).catch(() => {});
                shell.openExternal(cachedAuthData.url);
            });

            btnCancel.addEventListener('click', () => cleanup(null));
            btnConfirm.addEventListener('click', handleConfirm);
            inputAuthCode.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleConfirm();
            });

            async function handleConfirm() {
                const code = inputAuthCode.value.trim();
                if (!code) {
                    alert('请输入授权码 (Authorization Code)');
                    inputAuthCode.focus();
                    return;
                }
                if (!cachedAuthData) {
                    alert('授权链接尚未准备好，请稍候');
                    return;
                }

                // Show loading
                btnConfirm.disabled = true;
                btnConfirm.innerHTML = '<span class="material-symbols-outlined text-[14px] animate-spin">refresh</span> 校验中...';
                inputAuthCode.disabled = true;
                btnOpen.disabled = true;
                divError.classList.add('hidden');

                try {
                    const res = await ipcRenderer.invoke('auth:exchange-manual-code', {
                        code: code,
                        code_verifier: cachedAuthData.code_verifier
                    });

                    if (res.success) {
                        showStep3(res);
                    } else {
                        throw new Error(res.error || '未知错误');
                    }
                } catch (err) {
                    btnConfirm.disabled = false;
                    btnConfirm.innerHTML = '开始登录';
                    inputAuthCode.disabled = false;
                    btnOpen.disabled = false;
                    divError.innerHTML = '校验失败: ' + err.message;
                    divError.classList.remove('hidden');
                }
            }
        }

        function showStep3(exchangeRes) {
            const { email, access_token, refresh_token, activeProjectId, projects, listError } = exchangeRes;

            let projectUIHtml = '';
            if (projects && projects.length > 0) {
                projectUIHtml = `
                    <div class="flex flex-col gap-1.5">
                        <label class="text-[11px] text-outline font-bold uppercase">选择要绑定的 Google Cloud 项目：</label>
                        <select id="flowProjectSelect" class="w-full px-3 py-2 text-[13px] bg-slate-50 dark:bg-white/5 border border-outline-variant/30 rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface dark:text-white">
                            ${projects.map(p => `<option value="${p.projectId}" ${p.projectId === activeProjectId ? 'selected' : ''}>${p.name || p.projectId} (${p.projectId})</option>`).join('')}
                        </select>
                        <p class="text-[10px] text-outline leading-relaxed mt-0.5">已从您的云端账户成功获取项目列表。请选择一个启用了 Gemini/Cloud AI Companion 的项目。</p>
                    </div>
                `;
            } else {
                const displayError = listError ? ` (原因: ${listError})` : '';
                projectUIHtml = `
                    <div class="flex flex-col gap-2.5">
                        <div class="text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400 p-3 rounded-xl border border-amber-500/20 leading-relaxed flex items-start gap-1.5">
                            <span class="material-symbols-outlined text-[16px] shrink-0 mt-0.5">warning</span>
                            <div class="break-all">
                                自动从云端获取项目列表失败${displayError}。<br/>
                                由于谷歌官方 Client ID 的 API 限制，无法直接从云端列出您的项目。请在下方手动输入您的项目 ID。
                            </div>
                        </div>
                        <div class="flex flex-col gap-1.5">
                            <label class="text-[11px] text-outline font-bold uppercase">请输入您的 Google Cloud 项目 ID (Project ID)：</label>
                            <input type="text" id="flowProjectInput" value="${activeProjectId || ''}" placeholder="例如: my-api-495823" class="w-full px-3 py-2 text-[13px] bg-slate-50 dark:bg-white/5 border border-outline-variant/30 rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface dark:text-white placeholder-outline/60" autofocus />
                            <p class="text-[10px] text-outline leading-relaxed mt-0.5">项目 ID 可以从 <a href="https://console.cloud.google.com" target="_blank" class="text-primary hover:underline">Google Cloud 控制台</a> 首页的“项目信息”中复制。请输入精确的 Project ID，否则拦截请求时会报错。</p>
                        </div>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="flex items-center gap-2 text-primary">
                    <span class="material-symbols-outlined text-[20px]">cloud_sync</span>
                    <h3 class="text-base font-bold text-on-surface dark:text-white">绑定 GCP 项目</h3>
                </div>
                
                <div class="flex flex-col gap-3.5 my-1 text-[13px] text-on-surface dark:text-white">
                    <div class="text-[12px] text-outline leading-relaxed bg-slate-50 dark:bg-white/5 p-3.5 rounded-xl border border-outline-variant/20 flex flex-col gap-1.5">
                        <div class="flex justify-between">
                            <span class="text-outline">授权邮箱：</span>
                            <span class="font-bold font-data-mono text-on-surface dark:text-white">${email}</span>
                        </div>
                    </div>

                    ${projectUIHtml}
                    
                    <div id="flowSubmitError" class="text-[11px] text-red-500 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20 hidden break-all leading-normal"></div>
                </div>
                
                <div class="flex justify-end gap-2 mt-2">
                    <button id="flowCancel" type="button" class="px-4 py-1.5 text-[12px] font-medium bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-on-surface dark:text-white rounded-lg transition-colors border border-outline-variant/40">取消</button>
                    <button id="flowSubmit" type="button" class="px-4 py-1.5 text-[12px] font-bold bg-primary text-white hover:bg-primary/90 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1">确认绑定并登录</button>
                </div>
            `;

            const btnCancel = card.querySelector('#flowCancel');
            const btnSubmit = card.querySelector('#flowSubmit');
            const divSubmitError = card.querySelector('#flowSubmitError');
            const selectProject = card.querySelector('#flowProjectSelect');
            const inputProject = card.querySelector('#flowProjectInput');

            if (inputProject) setTimeout(() => inputProject.focus(), 50);

            btnCancel.addEventListener('click', () => cleanup(null));
            btnSubmit.addEventListener('click', handleSubmit);
            if (inputProject) {
                inputProject.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') handleSubmit();
                });
            }

            async function handleSubmit() {
                let projectId = '';
                if (selectProject) {
                    projectId = selectProject.value.trim();
                } else if (inputProject) {
                    projectId = inputProject.value.trim();
                }

                if (!projectId) {
                    alert('请输入或选择项目 ID');
                    if (inputProject) inputProject.focus();
                    return;
                }

                btnSubmit.disabled = true;
                btnSubmit.innerHTML = '<span class="material-symbols-outlined text-[14px] animate-spin">refresh</span> 绑定中...';
                if (inputProject) inputProject.disabled = true;
                if (selectProject) selectProject.disabled = true;
                divSubmitError.classList.add('hidden');

                try {
                    const res = await ipcRenderer.invoke('auth:add-manual-account', {
                        email,
                        access_token,
                        refresh_token,
                        projectId
                    });

                    if (res.success) {
                        cleanup({ success: true, email, projectId });
                    } else {
                        throw new Error(res.error || '未知错误');
                    }
                } catch (err) {
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = '确认绑定并登录';
                    if (inputProject) inputProject.disabled = false;
                    if (selectProject) selectProject.disabled = false;
                    divSubmitError.innerHTML = '保存失败: ' + err.message;
                    divSubmitError.classList.remove('hidden');
                }
            }
        }

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            card.classList.remove('scale-95');
        });

        showStep1And2();

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup(null);
        });
        document.addEventListener('keydown', function escListener(e) {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', escListener);
                cleanup(null);
            }
        });
    });
}

window.startProjectLogin = async function() {
    addAccountDropdown.classList.add('hidden');
    
    if (isLoadingAuth) return;
    isLoadingAuth = true;
    const origText = btnAddAccount.innerHTML;
    btnAddAccount.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span> 登录中...';
    btnAddAccount.classList.add('opacity-70', 'cursor-not-allowed');

    try {
        const result = await showOneStopAuthModal();
        if (result && result.success) {
            // Success, the accountManager will trigger events and update list
        }
    } catch (err) {
        alert('登录发生错误: ' + err.message);
    } finally {
        isLoadingAuth = false;
        btnAddAccount.innerHTML = origText;
        btnAddAccount.classList.remove('opacity-70', 'cursor-not-allowed');
    }
};

if (addAccountDropdown && !document.getElementById('btnProjectLogin')) {
    const projectLoginButton = document.createElement('button');
    projectLoginButton.id = 'btnProjectLogin';
    projectLoginButton.className = 'w-full text-left px-4 py-2 text-[13px] text-on-surface dark:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-center gap-2 border-t border-outline-variant/10 mt-1 pt-3';
    projectLoginButton.type = 'button';
    projectLoginButton.innerHTML = `
        <span class="material-symbols-outlined text-emerald-500 text-[16px]">cloud</span>
        <div>
            <div class="font-bold">Use a Google Cloud project</div>
            <div class="text-[10px] text-outline">先选项目，再登录并绑定到该项目</div>
        </div>
    `;
    projectLoginButton.addEventListener('click', () => startProjectLogin());
    if (addAccountDropdown.children.length >= 2) {
        addAccountDropdown.insertBefore(projectLoginButton, addAccountDropdown.children[1]);
    } else {
        addAccountDropdown.appendChild(projectLoginButton);
    }
}

function updatePoolModeUI() {
    const isPool = poolModeToggle.checked;
    const label = poolModeToggle.nextElementSibling;
    if (!label) return;
    
    if (isPool) {
        poolModeToggle.className = 'toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 border-primary appearance-none cursor-pointer translate-x-5 transition-transform duration-200 ease-in-out';
        label.className = 'toggle-label block overflow-hidden h-5 rounded-full bg-primary cursor-pointer';
    } else {
        poolModeToggle.className = 'toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out';
        label.className = 'toggle-label block overflow-hidden h-5 rounded-full bg-outline-variant/50 dark:bg-white/10 cursor-pointer';
    }
}

poolModeToggle.addEventListener('change', (e) => {
    if (currentViewTab === 'project') {
        ipcRenderer.send('pool:toggle-project', e.target.checked);
    } else {
        ipcRenderer.send('pool:toggle', e.target.checked);
    }
    updatePoolModeUI();
    updateAggregateQuotaUI();
});

const btnExportAccounts = document.getElementById('btnExportAccounts');
const btnImportAccounts = document.getElementById('btnImportAccounts');

if (btnExportAccounts) {
    btnExportAccounts.addEventListener('click', () => {
        ipcRenderer.send('accounts:export-all');
    });
}

if (btnImportAccounts) {
    btnImportAccounts.addEventListener('click', () => {
        ipcRenderer.send('accounts:import');
    });
}

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

function renderQuotaBars(containerEl, buckets, cooldowns = {}) {
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
            
            // Determine category
            const isClaude = groupName.toLowerCase().includes('claude');
            const category = isClaude ? 'claude' : 'gemini';
            
            // Check if this category is in cooldown
            let isCategoryCooling = false;
            let categoryCooldownUntil = 0;
            if (cooldowns && cooldowns[category]) {
                const now = Date.now();
                if (cooldowns[category] > now) {
                    isCategoryCooling = true;
                    categoryCooldownUntil = cooldowns[category];
                }
            }

            const groupContainer = document.createElement('div');
            // 如果不是第一个组，增加顶部间距
            groupContainer.className = `flex flex-col gap-2 bg-[#f8fafc]/60 dark:bg-[#20293d]/30 border border-slate-100 dark:border-slate-800/30 rounded-lg p-2.5 ${idx > 0 ? 'mt-2' : 'mt-1'}`;
            
            const groupTitle = document.createElement('div');
            groupTitle.className = 'text-[10px] font-bold text-on-surface dark:text-white flex items-center justify-between border-b border-outline-variant/10 pb-1.5 mb-1';
            
            let cooldownBadge = '';
            if (isCategoryCooling) {
                const dateStr = new Date(categoryCooldownUntil).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
                cooldownBadge = `<span class="px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[8px] font-bold border border-amber-500/20">${dateStr} 恢复</span>`;
            }

            groupTitle.innerHTML = `
                <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full ${isCategoryCooling ? 'bg-amber-500' : 'bg-primary'} animate-pulse"></span>
                    <span>${groupName}</span>
                </div>
                ${cooldownBadge}
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

async function loadAccountQuota(accountId, containerEl, refreshBtn, force = false, cooldowns = {}) {
    if (!force && quotaCache[accountId]) {
        renderQuotaBars(containerEl, quotaCache[accountId], cooldowns);
        updateAggregateQuotaUI();
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
            renderQuotaBars(containerEl, result.buckets, cooldowns);
            updateAggregateQuotaUI();
        }
    } catch (e) {
        containerEl.innerHTML = `<span class="text-[10px] text-red-400">请求失败</span>`;
    } finally {
        refreshBtn.classList.remove('animate-spin');
    }
}

function renderAccounts(accounts) {
    currentAccountsList = accounts;
    
    // Filter accounts based on currentViewTab
    const filteredAccounts = accounts.filter(acc => {
        const accountChannel = acc.provider === 'antigravity' ? 'antigravity' : 'project';
        return accountChannel === currentViewTab;
    });

    accountCountBadge.textContent = `共 ${filteredAccounts.length} 个账号`;
    accountsList.innerHTML = '';
    
    if (filteredAccounts.length === 0) {
        accountsEmptyState.classList.remove('hidden');
        accountsEmptyState.classList.add('flex');
        accountsList.classList.add('hidden');
        return;
    }
    
    accountsEmptyState.classList.add('hidden');
    accountsEmptyState.classList.remove('flex');
    accountsList.classList.remove('hidden');
    
    filteredAccounts.forEach(acc => {
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

        const projectBadge = (acc.provider !== 'antigravity' && acc.projectId)
            ? '<span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold border border-emerald-500/20 ml-2 mt-0.5 self-center">Project</span>'
            : '';

        // 增加订阅级别 Tier Badge
        let tierBadge = '';
        if (acc.tier) {
            const tierStr = acc.tier.toUpperCase();
            if (tierStr === 'PRO') {
                tierBadge = '<span class="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500 dark:text-rose-400 text-[9px] font-bold border border-rose-500/20 ml-2 mt-0.5 self-center">Pro</span>';
            } else if (tierStr === 'ULTRA') {
                tierBadge = '<span class="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[9px] font-bold border border-purple-500/20 ml-2 mt-0.5 self-center font-extrabold tracking-wide">Ultra</span>';
            } else if (tierStr === 'ENTERPRISE') {
                tierBadge = '<span class="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[9px] font-bold border border-blue-500/20 ml-2 mt-0.5 self-center">Enterprise</span>';
            } else if (tierStr === 'STANDARD') {
                tierBadge = '<span class="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 text-[9px] font-bold border border-sky-500/20 ml-2 mt-0.5 self-center">Standard</span>';
            } else if (tierStr === 'FREE') {
                tierBadge = '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300 text-[9px] font-bold border border-outline-variant/30 ml-2 mt-0.5 self-center">Free</span>';
            } else {
                tierBadge = `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300 text-[9px] font-bold border border-outline-variant/30 ml-2 mt-0.5 self-center">${acc.tier}</span>`;
            }
        }

        let projectInfoStr = '';
        if (acc.provider === 'antigravity' && acc.projectId) {
            projectInfoStr = ` | 绑定项目: ${acc.projectId}`;
        }

        info.innerHTML = `
            <div class="flex items-center">
                <span class="text-[13px] font-bold text-on-surface dark:text-white truncate" title="${acc.email}">${acc.email}</span>
                ${providerBadge}
                ${projectBadge}
                ${tierBadge}
            </div>
            <span class="text-[11px] text-outline mt-0.5 truncate">添加于: ${new Date(acc.addedAt).toLocaleString()}${projectInfoStr}</span>
        `;
        
        let isCooling = false;
        let coolingCategories = [];
        let maxCooldownTime = 0;
        const now = Date.now();
        if (acc.cooldowns) {
            Object.entries(acc.cooldowns).forEach(([cat, until]) => {
                if (until && until > now) {
                    coolingCategories.push(cat);
                    if (until > maxCooldownTime) {
                        maxCooldownTime = until;
                    }
                }
            });
        }
        if (coolingCategories.length === 0 && acc.cooldownUntil) {
            if (acc.cooldownUntil > now) {
                coolingCategories.push('all');
                maxCooldownTime = acc.cooldownUntil;
            }
        }
        isCooling = coolingCategories.length > 0;
        
        // Only show overall cooling state if ALL model categories are cooling down
        const totalCategoriesCount = 2;
        const isOverallCooling = coolingCategories.includes('all') || (coolingCategories.length === totalCategoriesCount);

        const statusBadge = document.createElement('div');
        if (isOverallCooling) {
            statusBadge.className = 'flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded text-nowrap self-start flex-shrink-0';
            const dateStr = new Date(maxCooldownTime).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
            statusBadge.innerHTML = `<span class="material-symbols-outlined text-[12px]">hourglass_empty</span> 冷静中 (${dateStr}恢复)`;
        } else {
            statusBadge.className = 'flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded text-nowrap self-start flex-shrink-0';
            statusBadge.innerHTML = '<span class="material-symbols-outlined text-[12px]">check_circle</span> 有效';
        }
        
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
        refreshBtn.onclick = () => loadAccountQuota(acc.id, quotaBars, refreshBtn, true, acc.cooldowns);

        // ---- Footer ----
        const footer = document.createElement('div');
        footer.className = 'flex justify-between items-center pt-1 border-t border-outline-variant/20';
        
        // 账号级启用/禁用 Toggle
        const toggleWrapper = document.createElement('div');
        toggleWrapper.className = 'flex items-center gap-1.5 select-none cursor-pointer';
        
        const switchId = `accToggle-${acc.id}`;
        const isChecked = acc.enabled !== false;
        toggleWrapper.innerHTML = `
            <div class="relative inline-block w-8 mr-1 align-middle select-none transition duration-200 ease-in">
                <input class="toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out" 
                    id="${switchId}" type="checkbox" ${isChecked ? 'checked' : ''}/>
                <label class="toggle-label block overflow-hidden h-4 rounded-full bg-outline-variant/50 dark:bg-white/10 cursor-pointer" for="${switchId}"></label>
            </div>
            <span class="text-[11px] font-bold ${isChecked ? 'text-emerald-500' : 'text-outline'}">${isChecked ? '启用中' : '已停用'}</span>
        `;
        
        const checkbox = toggleWrapper.querySelector('input');
        const labelText = toggleWrapper.querySelector('span');
        
        checkbox.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            ipcRenderer.send('accounts:toggle-enabled', acc.id, enabled);
            acc.enabled = enabled; // Update local state directly for immediate aggregation update
            if (enabled) {
                checkbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-primary appearance-none cursor-pointer translate-x-4 transition-transform duration-200 ease-in-out';
                labelText.className = 'text-[11px] font-bold text-emerald-500';
                labelText.textContent = '启用中';
                card.classList.remove('opacity-60');
            } else {
                checkbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out';
                labelText.className = 'text-[11px] font-bold text-outline';
                labelText.textContent = '已停用';
                card.classList.add('opacity-60');
            }
            updateAggregateQuotaUI();
        });
        
        // Initial state styling
        if (!isChecked) {
            card.classList.add('opacity-60');
            checkbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out';
        } else {
            checkbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-primary appearance-none cursor-pointer translate-x-4 transition-transform duration-200 ease-in-out';
        }
        
        const btnDownload = document.createElement('button');
        btnDownload.className = 'text-[11px] font-medium text-primary hover:text-primary/80 hover:bg-primary/5 dark:hover:bg-primary/10 px-2 py-1 rounded transition-colors flex items-center gap-1 z-10 mr-1';
        btnDownload.innerHTML = '<span class="material-symbols-outlined text-[14px]">download</span> 导出';
        btnDownload.title = '导出该账号文件';
        btnDownload.onclick = () => {
            ipcRenderer.send('accounts:export-single', acc.id);
        };

        const btnDelete = document.createElement('button');
        btnDelete.className = 'text-[11px] font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded transition-colors flex items-center gap-1 z-10';
        btnDelete.innerHTML = '<span class="material-symbols-outlined text-[14px]">delete</span> 移除';
        btnDelete.onclick = () => {
            if (confirm(`确定要移除账号 ${acc.email} 吗？`)) {
                ipcRenderer.send('accounts:remove', acc.id);
            }
        };
        
        const rightGroup = document.createElement('div');
        rightGroup.className = 'flex items-center gap-1';
        rightGroup.appendChild(btnDownload);
        rightGroup.appendChild(btnDelete);
        
        footer.appendChild(toggleWrapper);
        footer.appendChild(rightGroup);
        
        card.appendChild(header);
        card.appendChild(quotaSection);
        card.appendChild(footer);
        accountsList.appendChild(card);

        // Auto-load quota on render
        loadAccountQuota(acc.id, quotaBars, refreshBtn, false, acc.cooldowns);
    });
}

const btnChannelAntigravity = document.getElementById('btnChannelAntigravity');
const btnChannelProject = document.getElementById('btnChannelProject');
const poolModeContainer = document.getElementById('poolModeContainer');
const lblPoolMode = document.getElementById('lblPoolMode');

if (btnChannelAntigravity) {
    btnChannelAntigravity.addEventListener('click', () => {
        currentViewTab = 'antigravity';
        ipcRenderer.send('channel:switch', 'antigravity');
        updateViewTabUI();
        if (currentAccountsList) {
            renderAccounts(currentAccountsList);
        }
        updateAggregateQuotaUI();
    });
}
if (btnChannelProject) {
    btnChannelProject.addEventListener('click', () => {
        currentViewTab = 'project';
        ipcRenderer.send('channel:switch', 'project');
        updateViewTabUI();
        if (currentAccountsList) {
            renderAccounts(currentAccountsList);
        }
        updateAggregateQuotaUI();
    });
}

function updateViewTabUI() {
    if (btnChannelAntigravity && btnChannelProject) {
        if (currentViewTab === 'antigravity') {
            btnChannelAntigravity.className = 'px-4 py-1.5 rounded-md font-bold cursor-pointer transition-all duration-200 bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim shadow-sm';
            btnChannelProject.className = 'px-4 py-1.5 rounded-md font-medium cursor-pointer transition-all duration-200 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200';
            
            // Show pool toggle container for Antigravity, set label to "账号负载均衡"
            if (poolModeContainer) poolModeContainer.classList.remove('hidden');
            if (lblPoolMode) lblPoolMode.innerText = '账号负载均衡';
            if (poolModeToggle && lastBackendData) {
                poolModeToggle.checked = lastBackendData.poolMode;
            }
        } else {
            btnChannelProject.className = 'px-4 py-1.5 rounded-md font-bold cursor-pointer transition-all duration-200 bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim shadow-sm';
            btnChannelAntigravity.className = 'px-4 py-1.5 rounded-md font-medium cursor-pointer transition-all duration-200 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200';
            
            // Show pool toggle container for Projects, set label to "项目负载均衡"
            if (poolModeContainer) poolModeContainer.classList.remove('hidden');
            if (lblPoolMode) lblPoolMode.innerText = '项目负载均衡';
            if (poolModeToggle && lastBackendData) {
                poolModeToggle.checked = lastBackendData.projectPoolMode;
            }
        }
        updatePoolModeUI();
    }

    // Toggle dropdown options visibility based on current view tab
    const btnAntigravityLogin = document.getElementById('btnAntigravityLogin');
    const btnGeminiCliLogin = document.getElementById('btnGeminiCliLogin');
    const btnProjectLogin = document.getElementById('btnProjectLogin');
    
    if (currentViewTab === 'antigravity') {
        if (btnAntigravityLogin) btnAntigravityLogin.classList.remove('hidden');
        if (btnGeminiCliLogin) btnGeminiCliLogin.classList.remove('hidden');
        if (btnProjectLogin) btnProjectLogin.classList.add('hidden');
    } else {
        if (btnAntigravityLogin) btnAntigravityLogin.classList.add('hidden');
        if (btnGeminiCliLogin) btnGeminiCliLogin.classList.add('hidden');
        if (btnProjectLogin) btnProjectLogin.classList.remove('hidden');
    }
}

ipcRenderer.on('accounts-res', (event, data) => {
    lastBackendData = data;
    if (data && typeof data.activeChannel !== 'undefined') {
        currentActiveChannel = data.activeChannel;
    }
    
    if (!currentViewTab) {
        currentViewTab = currentActiveChannel;
    }
    
    updateViewTabUI();

    if (data.accounts) {
        currentAccountsList = data.accounts;
        renderAccounts(data.accounts);
    }
    updateAggregateQuotaUI();
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

// --- Updater Management UI ---
const lblCurrentVersion = document.getElementById('lblCurrentVersion');
const btnCheckUpdate = document.getElementById('btnCheckUpdate');
const iconCheckUpdate = document.getElementById('iconCheckUpdate');
const lblBtnCheckUpdate = document.getElementById('lblBtnCheckUpdate');
const updateStatusContainer = document.getElementById('updateStatusContainer');
const updateStatusIcon = document.getElementById('updateStatusIcon');
const updateStatusTitle = document.getElementById('updateStatusTitle');
const updateStatusMsg = document.getElementById('updateStatusMsg');
const updateProgressBarContainer = document.getElementById('updateProgressBarContainer');
const updateProgressBarFill = document.getElementById('updateProgressBarFill');
const updateActionsGroup = document.getElementById('updateActionsGroup');
const btnUpdateActionConfirm = document.getElementById('btnUpdateActionConfirm');
const btnUpdateActionCancel = document.getElementById('btnUpdateActionCancel');

let latestUpdateAssets = null;
let downloadedInstallerPath = null;
let updaterState = 'idle'; // idle, checking, update-available, no-update, downloading, downloaded, error

function setUpdaterUIState(state, info = {}) {
    updaterState = state;
    const dict = i18n[currentLanguage];

    // Reset visibility defaults
    updateStatusContainer.classList.remove('hidden');
    updateProgressBarContainer.classList.add('hidden');
    updateActionsGroup.classList.add('hidden');
    
    btnCheckUpdate.disabled = false;
    iconCheckUpdate.classList.remove('animate-spin');

    if (state === 'idle') {
        updateStatusContainer.classList.add('hidden');
    } else if (state === 'checking') {
        btnCheckUpdate.disabled = true;
        iconCheckUpdate.classList.add('animate-spin');
        
        updateStatusIcon.textContent = 'sync';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-primary animate-spin';
        updateStatusTitle.textContent = dict.checkingUpdates || '正在检查更新...';
        updateStatusMsg.textContent = '';
    } else if (state === 'update-available') {
        updateStatusIcon.textContent = 'rocket_launch';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-amber-500';
        updateStatusTitle.textContent = (dict.updateAvailable || '发现新版本可用！') + ` (${info.latestVersion})`;
        
        // Show release notes
        updateStatusMsg.textContent = info.releaseNotes || 'No release notes.';
        
        // Setup Action buttons
        updateActionsGroup.classList.remove('hidden');
        btnUpdateActionConfirm.textContent = dict.btnUpdateNow || '立即更新';
        btnUpdateActionConfirm.className = 'px-3 py-1.5 bg-primary text-white hover:bg-primary/90 rounded-md text-[12px] font-bold transition-all shadow-sm cursor-pointer';
        
        btnUpdateActionConfirm.onclick = async () => {
            if (latestUpdateAssets) {
                setUpdaterUIState('downloading');
                try {
                    await ipcRenderer.invoke('app:start-download-update', latestUpdateAssets);
                } catch (err) {
                    setUpdaterUIState('error', { message: err.message || err });
                }
            }
        };

        btnUpdateActionCancel.textContent = dict.btnUpdateLater || '暂不更新';
        btnUpdateActionCancel.onclick = () => {
            setUpdaterUIState('idle');
        };
    } else if (state === 'no-update') {
        updateStatusIcon.textContent = 'check_circle';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-emerald-500';
        updateStatusTitle.textContent = dict.alreadyLatest || '已是最新版本';
        updateStatusMsg.textContent = '';
        
        setTimeout(() => {
            if (updaterState === 'no-update') {
                setUpdaterUIState('idle');
            }
        }, 3000);
    } else if (state === 'downloading') {
        btnCheckUpdate.disabled = true;
        updateStatusIcon.textContent = 'download';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-primary animate-bounce';
        updateStatusTitle.textContent = dict.downloadingUpdate || '正在下载更新包...';
        
        const percent = info.percent || 0;
        updateStatusMsg.textContent = `Progress: ${percent}%`;
        
        updateProgressBarContainer.classList.remove('hidden');
        updateProgressBarFill.style.width = `${percent}%`;
    } else if (state === 'downloaded') {
        btnCheckUpdate.disabled = true;
        updateStatusIcon.textContent = 'download_done';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-emerald-500';
        updateStatusTitle.textContent = dict.downloadComplete || '下载完成，重启后生效';
        updateStatusMsg.textContent = '';
        
        // Setup Restart buttons
        updateActionsGroup.classList.remove('hidden');
        btnUpdateActionConfirm.textContent = dict.btnRestartNow || '立即重启';
        btnUpdateActionConfirm.className = 'px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-md text-[12px] font-bold transition-all shadow-sm cursor-pointer';
        btnUpdateActionConfirm.onclick = () => {
            if (downloadedInstallerPath) {
                ipcRenderer.send('app:install-update', downloadedInstallerPath);
            }
        };

        btnUpdateActionCancel.textContent = dict.btnLaterRestart || '稍后重启';
        btnUpdateActionCancel.onclick = () => {
            setUpdaterUIState('idle');
        };
    } else if (state === 'error') {
        updateStatusIcon.textContent = 'error';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-rose-500';
        updateStatusTitle.textContent = dict.updateFailed || '更新失败';
        updateStatusMsg.textContent = info.message || 'Unknown error occurred.';
        
        setTimeout(() => {
            if (updaterState === 'error') {
                setUpdaterUIState('idle');
            }
        }, 5000);
    }
}

// IPC listeners for updater events
ipcRenderer.on('app:update-available', (event, data) => {
    latestUpdateAssets = data.assets;
    downloadedInstallerPath = null;
    setUpdaterUIState('update-available', data);
});

ipcRenderer.on('app:update-not-available', (event, data) => {
    setUpdaterUIState('no-update', data);
});

ipcRenderer.on('app:download-progress', (event, progress) => {
    setUpdaterUIState('downloading', progress);
});

ipcRenderer.on('app:download-complete', (event, filePath) => {
    downloadedInstallerPath = filePath;
    setUpdaterUIState('downloaded');
});

ipcRenderer.on('app:update-error', (event, errMsg) => {
    setUpdaterUIState('error', { message: errMsg });
});

btnCheckUpdate.addEventListener('click', async () => {
    setUpdaterUIState('checking');
    try {
        await ipcRenderer.invoke('app:check-for-updates', true);
    } catch (err) {
        setUpdaterUIState('error', { message: err.message || err });
    }
});

// Load App Version
async function initAppVersion() {
    try {
        const ver = await ipcRenderer.invoke('app:get-version');
        if (lblCurrentVersion) {
            lblCurrentVersion.textContent = `v${ver}`;
        }
    } catch (err) {
        console.error('Failed to get app version:', err);
    }
}

function updateAggregateQuotaUI() {
    const panel = document.getElementById('aggregate-quota-panel');
    const grid = document.getElementById('aggregate-quota-grid');
    const info = document.getElementById('aggregate-quota-info');
    if (!panel || !grid || !info) return;

    const isPool = poolModeToggle.checked;
    if (!isPool || !currentAccountsList || currentAccountsList.length === 0) {
        panel.classList.add('hidden');
        panel.classList.remove('flex');
        return;
    }

    panel.classList.remove('hidden');
    panel.classList.add('flex');

    let categories = [
        { group: 'Gemini Models', modelId: 'Weekly Limit', label: 'Gemini Weekly', key: 'gemini_weekly' },
        { group: 'Gemini Models', modelId: 'Five Hour Limit', label: 'Gemini 5-Hour', key: 'gemini_5hour' },
        { group: 'Claude and GPT models', modelId: 'Weekly Limit', label: 'Claude Weekly', key: 'claude_weekly' },
        { group: 'Claude and GPT models', modelId: 'Five Hour Limit', label: 'Claude 5-Hour', key: 'claude_5hour' }
    ];

    if (currentActiveChannel === 'project') {
        categories = categories.filter(c => c.key === 'gemini_weekly');
    }

    const sums = {
        gemini_weekly: { sum: 0, count: 0 },
        gemini_5hour: { sum: 0, count: 0 },
        claude_weekly: { sum: 0, count: 0 },
        claude_5hour: { sum: 0, count: 0 }
    };

    const enabledAccounts = currentAccountsList.filter(a => {
        const accountChannel = a.provider === 'antigravity' ? 'antigravity' : 'project';
        return accountChannel === currentActiveChannel && a.enabled !== false;
    });

    enabledAccounts.forEach(acc => {
        const buckets = quotaCache[acc.id];
        if (buckets && buckets.length > 0) {
            categories.forEach(cat => {
                const bucket = buckets.find(b => {
                    const bg = (b.group || '').toLowerCase();
                    const bm = (b.modelId || b.model || '').toLowerCase();
                    const cg = cat.group.toLowerCase();
                    const cm = cat.modelId.toLowerCase();
                    return (bg.includes(cg) || cg.includes(bg)) && (bm.includes(cm) || cm.includes(bm));
                });
                
                if (bucket) {
                    const percent = typeof bucket.remainPercent === 'number' ? bucket.remainPercent : (bucket.remainingFraction * 100);
                    sums[cat.key].sum += percent;
                    sums[cat.key].count += 1;
                }
            });
        }
    });

    grid.innerHTML = '';
    let totalAccountsWithQuota = 0;
    const enabledAccountIds = new Set(enabledAccounts.map(a => a.id));
    
    Object.keys(quotaCache).forEach(accId => {
        if (enabledAccountIds.has(accId)) {
            totalAccountsWithQuota++;
        }
    });
    
    info.textContent = `汇总 ${totalAccountsWithQuota}/${enabledAccounts.length} 个账号的额度`;

    categories.forEach(cat => {
        const data = sums[cat.key];
        const cell = document.createElement('div');
        cell.className = 'flex flex-col gap-1 bg-slate-50/50 dark:bg-white/5 p-2 rounded-lg border border-outline-variant/20 flex-1 min-w-0';

        if (data.count > 0) {
            const avgPercent = Math.round(data.sum / data.count);
            
            let colorClass = 'bg-emerald-500';
            let textClass = 'text-emerald-500 dark:text-emerald-400';
            if (avgPercent < 30) {
                colorClass = 'bg-red-500';
                textClass = 'text-red-500 dark:text-red-400';
            } else if (avgPercent < 60) {
                colorClass = 'bg-amber-500';
                textClass = 'text-amber-500 dark:text-amber-400';
            }

            cell.innerHTML = `
                <div class="flex justify-between text-[11px] font-semibold items-center">
                    <span class="text-on-surface dark:text-white truncate pr-1" title="${cat.group} - ${cat.modelId}">${cat.label}</span>
                    <span class="${textClass} font-bold">${avgPercent}%</span>
                </div>
                <div class="w-full h-1 bg-outline-variant/20 dark:bg-white/5 rounded-full overflow-hidden">
                    <div class="${colorClass} h-full transition-all duration-300" style="width: ${avgPercent}%;"></div>
                </div>
            `;
        } else {
            cell.innerHTML = `
                <div class="flex justify-between text-[11px] font-semibold items-center">
                    <span class="text-on-surface dark:text-white truncate" title="${cat.group} - ${cat.modelId}">${cat.label}</span>
                    <span class="text-outline/40 font-bold">-</span>
                </div>
                <div class="w-full h-1 bg-outline-variant/20 dark:bg-white/5 rounded-full overflow-hidden flex items-center justify-center">
                    <div class="bg-outline-variant/30 h-full w-0"></div>
                </div>
            `;
        }
        grid.appendChild(cell);
    });
}

let isRefreshingAggregate = false;
async function refreshAllAccountsQuotas() {
    if (isRefreshingAggregate || !currentAccountsList || currentAccountsList.length === 0) return;
    isRefreshingAggregate = true;

    const btn = document.getElementById('btnRefreshAggregateQuota');
    const icon = document.getElementById('btnRefreshAggregateIcon');
    if (btn && icon) {
        icon.classList.add('animate-spin');
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-not-allowed');
    }

    try {
        for (const acc of currentAccountsList) {
            try {
                const result = await ipcRenderer.invoke('quota:fetch', acc.id);
                if (result && !result.error) {
                    quotaCache[acc.id] = result.buckets;
                }
            } catch (err) {
                console.error(`Failed to refresh quota for ${acc.email}:`, err);
            }
            await new Promise(r => setTimeout(r, 100));
        }
        updateAggregateQuotaUI();
        if (accountsList && accountsList.children.length > 0) {
            renderAccounts(currentAccountsList);
        }
    } finally {
        isRefreshingAggregate = false;
        if (btn && icon) {
            icon.classList.remove('animate-spin');
            btn.disabled = false;
            btn.classList.remove('opacity-60', 'cursor-not-allowed');
        }
    }
}

// --- 异常与重试日志弹窗及交互逻辑 ---
(function() {
    const btnViewRetries = document.getElementById('btnViewRetries');
    const btnViewErrors = document.getElementById('btnViewErrors');
    const modal = document.getElementById('retryErrorLogsModal');
    const container = document.getElementById('retryErrorLogsModalContainer');
    const closeBtn = document.getElementById('retryErrorLogsModalCloseBtn');
    const closeBtnSec = document.getElementById('retryErrorLogsModalCloseBtnSecondary');
    const filter = document.getElementById('logTypeFilter');
    const tableBody = document.getElementById('retryErrorLogsTableBody');
    const emptyState = document.getElementById('retryErrorLogsEmpty');
    const countBadge = document.getElementById('retryErrorLogsCount');
    const btnClear = document.getElementById('btnClearRetryErrorLogs');
    const btnExport = document.getElementById('btnExportRetryErrorLogs');

    let logsList = [];

    // 打开弹窗
    async function openModal(filterType = 'ALL') {
        if (!modal) return;
        
        // 设置筛选器
        if (filter) {
            filter.value = filterType;
        }

        // 动画显示
        modal.classList.remove('pointer-events-none', 'opacity-0');
        modal.classList.add('opacity-100');
        if (container) {
            container.classList.remove('scale-95');
            container.classList.add('scale-100');
        }

        // 加载数据
        await fetchAndRenderLogs();
    }

    // 关闭弹窗
    function closeModal() {
        if (!modal) return;
        modal.classList.add('pointer-events-none', 'opacity-0');
        modal.classList.remove('opacity-100');
        if (container) {
            container.classList.add('scale-95');
            container.classList.remove('scale-100');
        }
    }

    // 获取并渲染数据
    async function fetchAndRenderLogs() {
        try {
            logsList = await ipcRenderer.invoke('retry-error-logs:get') || [];
            renderLogs();
        } catch (e) {
            console.error('Failed to fetch retry/error logs:', e);
        }
    }

    // 渲染函数
    function renderLogs() {
        if (!tableBody) return;

        const filterVal = filter ? filter.value : 'ALL';
        const filtered = logsList.filter(log => {
            if (filterVal === 'ALL') return true;
            return log.type === filterVal;
        });

        if (countBadge) {
            countBadge.textContent = `${filtered.length} 条记录`;
        }

        if (filtered.length === 0) {
            tableBody.innerHTML = '';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        tableBody.innerHTML = filtered.map(log => {
            const typeBadge = log.type === 'RETRY'
                ? '<span class="px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">重试</span>'
                : '<span class="px-2 py-0.5 rounded-full font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">报错</span>';

            const email = log.account || '-';
            const model = log.model || '-';
            const path = log.path || '-';
            const attemptStr = log.type === 'RETRY' ? `第 ${log.attempt} 次` : '最终失败';
            const errorMsg = log.error || '-';

            return `
                <tr class="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors border-b border-outline-variant/10 dark:border-white/5">
                    <td class="px-4 py-3 font-data-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">${log.timestamp}</td>
                    <td class="px-4 py-3 whitespace-nowrap">${typeBadge}</td>
                    <td class="px-4 py-3 font-data-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">${attemptStr}</td>
                    <td class="px-4 py-3 font-data-mono text-slate-600 dark:text-slate-300 break-all select-all">${email}</td>
                    <td class="px-4 py-3 font-sans text-slate-600 dark:text-slate-300 whitespace-nowrap">${model}</td>
                    <td class="px-4 py-3 font-data-mono text-primary dark:text-primary-fixed-dim break-all select-all">${path}</td>
                    <td class="px-4 py-3 font-data-mono text-rose-600 dark:text-rose-400 break-all select-text font-semibold">${errorMsg}</td>
                </tr>
            `;
        }).join('');
    }

    // 绑定基础事件
    if (btnViewRetries) {
        btnViewRetries.addEventListener('click', () => openModal('RETRY'));
    }
    if (btnViewErrors) {
        btnViewErrors.addEventListener('click', () => openModal('ERROR'));
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    if (closeBtnSec) {
        closeBtnSec.addEventListener('click', closeModal);
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }
    if (filter) {
        filter.addEventListener('change', renderLogs);
    }

    // 清空日志
    if (btnClear) {
        btnClear.addEventListener('click', async () => {
            const filterVal = filter ? filter.value : 'ALL';
            let confirmMsg = '确定要清空所有重试和报错的日志记录吗？';
            if (filterVal === 'RETRY') {
                confirmMsg = '确定要清空所有的重试日志记录并把重试次数清零吗？';
            } else if (filterVal === 'ERROR') {
                confirmMsg = '确定要清空所有的报错日志记录并把报错次数清零吗？';
            }

            if (confirm(confirmMsg)) {
                const success = await ipcRenderer.invoke('retry-error-logs:clear', filterVal);
                if (success) {
                    await fetchAndRenderLogs();
                }
            }
        });
    }

    // 导出日志
    if (btnExport) {
        btnExport.addEventListener('click', async () => {
            const success = await ipcRenderer.invoke('retry-error-logs:export');
            if (success) {
                alert('日志成功导出！');
            }
        });
    }
})();
