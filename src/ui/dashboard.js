/**
 * Antigravity Proxy - Frontend Renderer Controller
 */

const { ipcRenderer, shell } = require('electron');
const i18n = require('./src/shared/i18n');
const usageDetails = require('./src/ui/usageDetails');

// Modularized imports
const state = require('./src/ui/dashboardState');
const chartRenderer = require('./src/ui/chartRenderer');
const pricingController = require('./src/ui/pricingController');
const accountsController = require('./src/ui/accountsController');
const packetsController = require('./src/ui/packetsController');

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

// Filter and render logs table with pagination
function renderLogsTable() {
    const dict = i18n[state.currentLanguage];
    
    // Filter requests
    const filtered = state.allRequests.filter(log => {
        if (!state.searchQuery) return true;
        const q = state.searchQuery.toLowerCase();
        return log.host.toLowerCase().includes(q) || 
               log.path.toLowerCase().includes(q) || 
               log.model.toLowerCase().includes(q) || 
               (log.sessionId || '').toLowerCase().includes(q) ||
               log.method.toLowerCase().includes(q);
    });

    // Pagination bounds
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / state.itemsPerPage) || 1;
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIndex = (state.currentPage - 1) * state.itemsPerPage;
    const endIndex = Math.min(startIndex + state.itemsPerPage, totalItems);
    const paginated = filtered.slice(startIndex, endIndex);

    if (!logsTableBody) return;
    logsTableBody.innerHTML = '';
    
    if (paginated.length === 0) {
        logsTableBody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-outline dark:text-outline-variant italic">${dict.noLogs}</td></tr>`;
        if (valShowingText) {
            valShowingText.textContent = state.currentLanguage === 'zh' ? `共 0 条记录` : `Showing 0 entries`;
        }
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

        const showingText = state.currentLanguage === 'zh'
            ? `显示第 ${startIndex + 1} 到 ${endIndex} 条，共 ${totalItems} 条记录`
            : `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} entries`;
        if (valShowingText) {
            valShowingText.textContent = showingText;
        }
    }

    // Render Pagination Controls
    if (!paginationControls) return;
    paginationControls.innerHTML = '';
    
    const addBtn = (label, pageNum, isActive = false, isDisabled = false) => {
        const btn = document.createElement('button');
        btn.className = `px-2.5 py-1 border border-outline-variant/60 rounded text-[12px] transition-colors ${
            isActive ? 'bg-primary text-white border-primary dark:bg-primary-container dark:border-primary-container' : 'bg-white dark:bg-[#1a1f30] text-on-surface dark:text-white hover:bg-slate-50 dark:hover:bg-white/5'
        } ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`;
        btn.textContent = label;
        if (!isDisabled) {
            btn.addEventListener('click', () => {
                state.currentPage = pageNum;
                renderLogsTable();
            });
        } else {
            btn.disabled = true;
        }
        paginationControls.appendChild(btn);
    };

    addBtn(state.currentLanguage === 'zh' ? '上一页' : 'Prev', state.currentPage - 1, false, state.currentPage === 1);

    let startPage = Math.max(1, state.currentPage - 1);
    let endPage = Math.min(totalPages, startPage + 2);
    if (endPage - startPage < 2) {
        startPage = Math.max(1, endPage - 2);
    }

    for (let p = startPage; p <= endPage; p++) {
        addBtn(p.toString(), p, p === state.currentPage);
    }

    if (endPage < totalPages) {
        const span = document.createElement('span');
        span.className = 'px-1 text-outline align-bottom';
        span.textContent = '...';
        paginationControls.appendChild(span);
        addBtn(totalPages.toString(), totalPages);
    }

    addBtn(state.currentLanguage === 'zh' ? '下一页' : 'Next', state.currentPage + 1, false, state.currentPage === totalPages);
}

// Multi-language Text Translation
function setLanguage(lang) {
    state.currentLanguage = lang;
    
    if (lang === 'zh') {
        toggleZH.className = 'px-2 py-0.5 text-[11px] font-medium bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim rounded-full shadow-sm';
        toggleEN.className = 'px-2 py-0.5 text-[11px] font-medium text-outline rounded-full transition-all';
    } else {
        toggleEN.className = 'px-2 py-0.5 text-[11px] font-medium bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim rounded-full shadow-sm';
        toggleZH.className = 'px-2 py-0.5 text-[11px] font-medium text-outline rounded-full transition-all';
    }
    
    const dict = i18n[lang];
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            el.textContent = dict[key];
        }
    });

    logSearchInput.placeholder = lang === 'zh' ? '搜索日志...' : 'Search logs...';

    updateStatusLabel();
    ipcRenderer.send('get-state');
    ipcRenderer.send('settings:language-changed', lang);
}

function updateStatusLabel() {
    if (!proxyToggle) return;
    const isIntercept = proxyToggle.checked;
    const dict = i18n[state.currentLanguage];
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
    state.currentTheme = theme;
    if (theme === 'dark') {
        html.classList.add('dark');
        html.setAttribute('data-theme', 'dark');
        themeIcon.textContent = 'light_mode';
    } else {
        html.classList.remove('dark');
        html.setAttribute('data-theme', 'light');
        themeIcon.textContent = 'dark_mode';
    }
}

// UI tab switching
function switchTab(tab) {
    state.activeTab = tab;
    
    const activeClass = 'px-4 py-2 text-[13px] font-bold text-primary border-b-2 border-primary';
    const inactiveClass = 'px-4 py-2 text-[13px] font-bold text-outline hover:text-primary transition-colors border-b-2 border-transparent';
    
    tabModels.className = tab === 'models' ? activeClass : inactiveClass;
    tabLogs.className = tab === 'logs' ? activeClass : inactiveClass;
    tabPricing.className = tab === 'pricing' ? activeClass : inactiveClass;
    
    modelsContent.classList.toggle('hidden', tab !== 'models');
    logsContent.classList.toggle('hidden', tab !== 'logs');
    pricingContent.classList.toggle('hidden', tab !== 'pricing');
    
    if (logSearchRow) {
        logSearchRow.classList.toggle('hidden', tab !== 'logs');
    }
    if (tableFooter) {
        tableFooter.classList.toggle('hidden', tab !== 'logs');
    }

    if (tab === 'pricing') {
        pricingController.fetchPricing();
    }
}

// Update Certificate Installation UI
function updateCertUI(isInstalled, isProcessing = false) {
    const dict = i18n[state.currentLanguage];
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
    state.searchQuery = e.target.value;
    state.currentPage = 1;
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
    const nextTheme = state.currentTheme === 'dark' ? 'light' : 'dark';
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

    if (typeof data.total === 'number') {
        if (state.memoryHistory.length === 0) {
            for (let i = 0; i < state.maxMemoryHistoryPoints; i++) {
                state.memoryHistory.push(totalMBVal);
            }
        } else {
            state.memoryHistory.push(totalMBVal);
            if (state.memoryHistory.length > state.maxMemoryHistoryPoints) {
                state.memoryHistory.shift();
            }
        }
        chartRenderer.updateMemoryChart();
    }
});

ipcRenderer.on('stats-updated', (event, payload) => {
    if (!payload) return;

    const { stats, trends, requests, usage } = payload;
    state.trendsData = trends;
    state.allRequests = requests;

    // 1. Update Metrics Cards
    const totalRequests = (stats.totalRequests || 0) + (stats.totalErrors || 0);
    valReqs.textContent = totalRequests;
    
    if (valRetries) {
        valRetries.textContent = stats.totalRetries || 0;
    }
    if (valErrors) {
        valErrors.textContent = stats.totalErrors || 0;
    }
    
    const successRate = totalRequests > 0 ? (stats.totalRequests / totalRequests * 100) : 100;
    if (valSuccessRate) {
        valSuccessRate.textContent = successRate.toFixed(1) + '%';
    }
    if (barSuccess && barErrors) {
        barSuccess.style.width = `${successRate}%`;
        barErrors.style.width = `${100 - successRate}%`;
    }

    valTokens.textContent = (stats.totalInputTokens + stats.totalOutputTokens).toLocaleString();
    
    const totalIn = stats.totalInputTokens - stats.totalCachedTokens;
    valTokensIn.textContent = chartRenderer.formatCompactNumber(totalIn);
    valTokensOut.textContent = chartRenderer.formatCompactNumber(stats.totalOutputTokens);
    if (valTotalCost) {
        valTotalCost.textContent = `$${(stats.totalCost || 0).toFixed(4)}`;
    }
    
    const totalSum = totalIn + stats.totalOutputTokens;
    const inPercent = totalSum > 0 ? (totalIn / totalSum * 100) : 50;
    const outPercent = 100 - inPercent;
    barTokensIn.style.width = `${inPercent}%`;
    barTokensOut.style.width = `${outPercent}%`;

    const hitRate = stats.totalInputTokens > 0 ? (stats.totalCachedTokens / stats.totalInputTokens * 100) : 0;
    valHitRate.textContent = hitRate.toFixed(1) + '%';
    valCached.textContent = chartRenderer.formatCompactNumber(state.quotaCache && stats.totalCachedTokens);
    valSavedCost.textContent = `$${(stats.totalCachedTokens * 0.3125 / 1000000).toFixed(2)}`;

    gaugeCircle.setAttribute('stroke-dasharray', `${hitRate.toFixed(1)}, 100`);

    // 2. Draw SVG Area Trend line
    const filteredTrends = chartRenderer.getFilteredTrends(state.trendsData, state.currentRange);
    chartRenderer.drawTrendChartSVG(filteredTrends, state.currentRange);

    // 3. Render Model Stats Table
    modelsTableBody.innerHTML = '';
    const dict = i18n[state.currentLanguage];
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

    // 4. Render Request Logs
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

// --- Settings Directory Path UI ---
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
window.refreshDataDir = refreshDataDir;

if (btnBrowseDir) {
    btnBrowseDir.addEventListener('click', async () => {
        migrationStatus.classList.add('hidden');
        migrationStatusMsg.innerText = '';
        btnBrowseDir.disabled = true;
        try {
            const result = await ipcRenderer.invoke('settings:change-dir');
            if (result.success && result.activeDir) {
                txtDataDir.value = result.activeDir;
            } else if (result.error && result.error !== '用户取消选择') {
                showMigrationError(result.error);
            }
        } catch (err) {
            showMigrationError(err.message);
        } finally {
            btnBrowseDir.disabled = false;
        }
    });
}

function showMigrationError(errText) {
    migrationStatus.classList.remove('hidden');
    migrationStatus.className = 'text-[12px] p-3 rounded-lg border bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900/30 flex flex-col gap-1';
    const isZH = state.currentLanguage === 'zh';
    migrationStatusMsg.innerText = (isZH ? '❌ 迁移失败：' : '❌ Migration failed: ') + errText;
    migrationStatusMsg.className = 'text-[12px] text-rose-600 dark:text-rose-400 mt-1 font-medium';
}

ipcRenderer.on('settings:migration-progress', (event, data) => {
    migrationStatus.classList.remove('hidden');
    const isZH = state.currentLanguage === 'zh';

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

// --- Updater Controller Logic ---
const lblCurrentVersion = document.getElementById('lblCurrentVersion');
const btnCheckUpdate = document.getElementById('btnCheckUpdate');
const iconCheckUpdate = document.getElementById('iconCheckUpdate');
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
let updaterState = 'idle';

function setUpdaterUIState(uiState, info = {}) {
    updaterState = uiState;
    const dict = i18n[state.currentLanguage];

    updateStatusContainer.classList.remove('hidden');
    updateProgressBarContainer.classList.add('hidden');
    updateActionsGroup.classList.add('hidden');
    btnCheckUpdate.disabled = false;
    iconCheckUpdate.classList.remove('animate-spin');

    if (uiState === 'idle') {
        updateStatusContainer.classList.add('hidden');
    } else if (uiState === 'checking') {
        btnCheckUpdate.disabled = true;
        iconCheckUpdate.classList.add('animate-spin');
        updateStatusIcon.textContent = 'sync';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-primary animate-spin';
        updateStatusTitle.textContent = dict.checkingUpdates || '正在检查更新...';
        updateStatusMsg.textContent = '';
    } else if (uiState === 'update-available') {
        updateStatusIcon.textContent = 'rocket_launch';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-amber-500';
        updateStatusTitle.textContent = (dict.updateAvailable || '发现新版本可用！') + ` (${info.latestVersion})`;
        updateStatusMsg.textContent = info.releaseNotes || 'No release notes.';
        
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
        btnUpdateActionCancel.onclick = () => setUpdaterUIState('idle');
    } else if (uiState === 'no-update') {
        updateStatusIcon.textContent = 'check_circle';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-emerald-500';
        updateStatusTitle.textContent = dict.alreadyLatest || '已是最新版本';
        updateStatusMsg.textContent = '';
        setTimeout(() => {
            if (updaterState === 'no-update') setUpdaterUIState('idle');
        }, 3000);
    } else if (uiState === 'downloading') {
        btnCheckUpdate.disabled = true;
        updateStatusIcon.textContent = 'download';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-primary animate-bounce';
        updateStatusTitle.textContent = dict.downloadingUpdate || '正在下载更新包...';
        
        const percent = info.percent || 0;
        updateStatusMsg.textContent = `Progress: ${percent}%`;
        updateProgressBarContainer.classList.remove('hidden');
        updateProgressBarFill.style.width = `${percent}%`;
    } else if (uiState === 'downloaded') {
        btnCheckUpdate.disabled = true;
        updateStatusIcon.textContent = 'download_done';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-emerald-500';
        updateStatusTitle.textContent = dict.downloadComplete || '下载完成，重启后生效';
        updateStatusMsg.textContent = '';
        
        updateActionsGroup.classList.remove('hidden');
        btnUpdateActionConfirm.textContent = dict.btnRestartNow || '立即重启';
        btnUpdateActionConfirm.className = 'px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-md text-[12px] font-bold transition-all shadow-sm cursor-pointer';
        btnUpdateActionConfirm.onclick = () => {
            if (downloadedInstallerPath) {
                ipcRenderer.send('app:install-update', downloadedInstallerPath);
            }
        };

        btnUpdateActionCancel.textContent = dict.btnLaterRestart || '稍后重启';
        btnUpdateActionCancel.onclick = () => setUpdaterUIState('idle');
    } else if (uiState === 'error') {
        updateStatusIcon.textContent = 'error';
        updateStatusIcon.className = 'material-symbols-outlined text-[16px] text-rose-500';
        updateStatusTitle.textContent = dict.updateFailed || '更新失败';
        updateStatusMsg.textContent = info.message || 'Unknown error occurred.';
        setTimeout(() => {
            if (updaterState === 'error') setUpdaterUIState('idle');
        }, 5000);
    }
}

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

if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', async () => {
        setUpdaterUIState('checking');
        try {
            await ipcRenderer.invoke('app:check-for-updates', true);
        } catch (err) {
            setUpdaterUIState('error', { message: err.message || err });
        }
    });
}

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

// Global page tab-switching router
function switchView(viewName) {
    const viewDashboard = document.getElementById('view-dashboard');
    const viewAccounts = document.getElementById('view-accounts');
    const viewSettings = document.getElementById('view-settings');
    const viewPackets = document.getElementById('view-packets');
    const navDashboard = document.getElementById('nav-dashboard');
    const navAccounts = document.getElementById('nav-accounts');
    const navSettings = document.getElementById('nav-settings');
    const navPackets = document.getElementById('nav-packets');

    if (!viewDashboard || !viewAccounts || !viewSettings || !viewPackets || !navDashboard || !navAccounts || !navSettings || !navPackets) {
        return;
    }

    if (viewName === 'dashboard') {
        viewDashboard.classList.remove('hidden');
        viewAccounts.classList.add('hidden');
        viewSettings.classList.add('hidden');
        viewPackets.classList.add('hidden');
        
        navDashboard.classList.add('border-b-2', 'border-primary');
        navDashboard.classList.remove('text-outline');
        navDashboard.classList.add('text-primary', 'dark:text-primary-fixed-dim');
        
        navAccounts.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navAccounts.classList.add('text-outline');
        navSettings.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navSettings.classList.add('text-outline');
        navPackets.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navPackets.classList.add('text-outline');
        
        accountsController.updateAggregateQuotaUI();
    } else if (viewName === 'accounts') {
        viewDashboard.classList.add('hidden');
        viewAccounts.classList.remove('hidden');
        viewAccounts.classList.add('flex');
        viewSettings.classList.add('hidden');
        viewPackets.classList.add('hidden');
        
        navAccounts.classList.add('border-b-2', 'border-primary');
        navAccounts.classList.remove('text-outline');
        navAccounts.classList.add('text-primary', 'dark:text-primary-fixed-dim');
        
        navDashboard.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navDashboard.classList.add('text-outline');
        navSettings.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navSettings.classList.add('text-outline');
        navPackets.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navPackets.classList.add('text-outline');
    } else if (viewName === 'settings') {
        viewDashboard.classList.add('hidden');
        viewAccounts.classList.add('hidden');
        viewSettings.classList.remove('hidden');
        viewSettings.classList.add('flex');
        viewPackets.classList.add('hidden');
        
        navSettings.classList.add('border-b-2', 'border-primary');
        navSettings.classList.remove('text-outline');
        navSettings.classList.add('text-primary', 'dark:text-primary-fixed-dim');
        
        navDashboard.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navDashboard.classList.add('text-outline');
        navAccounts.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navAccounts.classList.add('text-outline');
        navPackets.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navPackets.classList.add('text-outline');

        refreshDataDir();
    } else if (viewName === 'packets') {
        viewDashboard.classList.add('hidden');
        viewAccounts.classList.add('hidden');
        viewSettings.classList.add('hidden');
        viewPackets.classList.remove('hidden');
        viewPackets.classList.add('flex');

        navPackets.classList.add('border-b-2', 'border-primary');
        navPackets.classList.remove('text-outline');
        navPackets.classList.add('text-primary', 'dark:text-primary-fixed-dim');

        navDashboard.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navDashboard.classList.add('text-outline');
        navAccounts.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navAccounts.classList.add('text-outline');
        navSettings.classList.remove('border-b-2', 'border-primary', 'text-primary', 'dark:text-primary-fixed-dim');
        navSettings.classList.add('text-outline');

        packetsController.refreshPacketsList();
        packetsController.updateAnalyzeAccountSelect();
    }
}
window.switchView = switchView;

// Forward event listeners and hook packets notification
ipcRenderer.on('packet:new', () => {
    const viewPackets = document.getElementById('view-packets');
    if (viewPackets && !viewPackets.classList.contains('hidden')) {
        packetsController.refreshPacketsList();
    }
});

// Forward accounts res
ipcRenderer.on('accounts-res', (event, data) => {
    state.lastBackendData = data;
    if (data && typeof data.activeChannel !== 'undefined') {
        state.currentActiveChannel = data.activeChannel;
    }
    if (!state.currentViewTab) {
        state.currentViewTab = state.currentActiveChannel;
    }
    accountsController.updateViewTabUI();
    if (data.accounts) {
        state.currentAccountsList = data.accounts;
        accountsController.renderAccounts(data.accounts);
    }
    accountsController.updateAggregateQuotaUI();
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
    if (!detailsModal || !modalContainer) return;
    detailsModal.classList.add('opacity-0', 'pointer-events-none');
    modalContainer.classList.add('scale-95');
    modalContainer.classList.remove('scale-100');
}

function showModal(log) {
    if (!detailsModal || !modalContainer) return;
    
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
            span.textContent = state.currentLanguage === 'zh' ? '已复制！' : 'Copied!';
            setTimeout(() => { span.textContent = '复制'; }, 1500);
        });
    };

    modalCopyBtn.onclick = () => {
        navigator.clipboard.writeText(formattedJson).then(() => {
            const originalText = modalCopyBtn.querySelector('span:not(.material-symbols-outlined)').textContent;
            modalCopyBtn.querySelector('span:not(.material-symbols-outlined)').textContent = state.currentLanguage === 'zh' ? '已复制！' : 'Copied!';
            setTimeout(() => {
                modalCopyBtn.querySelector('span:not(.material-symbols-outlined)').textContent = originalText;
            }, 1500);
        });
    };
    
    detailsModal.classList.remove('opacity-0', 'pointer-events-none');
    modalContainer.classList.remove('scale-95');
    modalContainer.classList.add('scale-100');
}

if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideModal);
if (modalCloseBtnSecondary) modalCloseBtnSecondary.addEventListener('click', hideModal);
if (detailsModal) {
    detailsModal.addEventListener('click', (e) => {
        if (e.target === detailsModal) hideModal();
    });
}

// --- Retry and Error Logs Modal interaction ---
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

    async function openModal(filterType = 'ALL') {
        if (!modal) return;
        if (filter) filter.value = filterType;
        modal.classList.remove('pointer-events-none', 'opacity-0');
        modal.classList.add('opacity-100');
        if (container) {
            container.classList.remove('scale-95');
            container.classList.add('scale-100');
        }
        await fetchAndRenderLogs();
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.add('pointer-events-none', 'opacity-0');
        modal.classList.remove('opacity-100');
        if (container) {
            container.classList.add('scale-95');
            container.classList.remove('scale-100');
        }
    }

    async function fetchAndRenderLogs() {
        try {
            logsList = await ipcRenderer.invoke('retry-error-logs:get') || [];
            renderLogs();
        } catch (e) {
            console.error('Failed to fetch retry/error logs:', e);
        }
    }

    function renderLogs() {
        if (!tableBody) return;
        const filterVal = filter ? filter.value : 'ALL';
        const filtered = logsList.filter(log => {
            if (filterVal === 'ALL') return true;
            return log.type === filterVal;
        });

        if (countBadge) countBadge.textContent = `${filtered.length} 条记录`;

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

    if (btnViewRetries) btnViewRetries.addEventListener('click', () => openModal('RETRY'));
    if (btnViewErrors) btnViewErrors.addEventListener('click', () => openModal('ERROR'));
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (closeBtnSec) closeBtnSec.addEventListener('click', closeModal);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }
    if (filter) filter.addEventListener('change', renderLogs);

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

    if (btnExport) {
        btnExport.addEventListener('click', async () => {
            const success = await ipcRenderer.invoke('retry-error-logs:export');
            if (success) {
                alert('日志成功导出！');
            }
        });
    }
})();

// Bind callbacks into global state object for cross-module invocations
state.callbacks.renderLogsTable = renderLogsTable;
state.callbacks.setLanguage = setLanguage;
state.callbacks.updateStatusLabel = updateStatusLabel;

// Entrance Initialization
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial State
    setTheme('light');
    setLanguage('zh');
    switchTab('logs');

    // 2. Initialize Controllers
    pricingController.initPricingEvents();
    accountsController.initAccountsEvents();
    packetsController.initPacketsEvents();
    chartRenderer.initChartFilters();

    // 3. Versioning and CA checks
    initAppVersion();
    requestCertStatus();

    // 4. Initial Fetch
    ipcRenderer.send('accounts:get');
});
