/**
 * Antigravity Proxy - Accounts & Quota Controller Component
 */

const { ipcRenderer, shell } = require('electron');
const state = require('./dashboardState');

// DOM Elements to be set during init or DOMContentLoaded
let btnAddAccount;
let addAccountDropdown;
let poolModeToggle;
let accountsList;
let accountsEmptyState;
let accountCountBadge;
let btnRefreshAllQuota;
let btnRefreshAllIcon;
let btnClearSessions;
let btnRefreshAggregateQuota;
let btnRefreshAggregateIcon;
let poolModeContainer;
let lblPoolMode;
let btnChannelAntigravity;
let btnChannelProject;
let btnExportAccounts;
let btnImportAccounts;

// Format reset time relatively
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

// Format cooldown time to absolute text
function formatCooldownTime(cooldownTime) {
    try {
        const now = new Date();
        const target = new Date(cooldownTime);
        const isToday = now.getFullYear() === target.getFullYear() &&
                        now.getMonth() === target.getMonth() &&
                        now.getDate() === target.getDate();
        
        const timeStr = target.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
        if (isToday) {
            return timeStr;
        } else {
            const month = target.getMonth() + 1;
            const date = target.getDate();
            return `${month}月${date}日 ${timeStr}`;
        }
    } catch (e) {
        return new Date(cooldownTime).toLocaleString();
    }
}

// Render account quota progress bars
function renderQuotaBars(containerEl, buckets, cooldowns = {}) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    if (!buckets || buckets.length === 0) {
        containerEl.innerHTML = '<span class="text-[10px] text-outline/50 italic">暂无配额数据</span>';
        return;
    }

    const hasGroups = buckets.some(b => b.group);

    if (hasGroups) {
        const groups = {};
        buckets.forEach(b => {
            const groupName = b.group || '其他模型';
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push(b);
        });

        Object.keys(groups).forEach((groupName, idx) => {
            const groupBuckets = groups[groupName];
            const isClaude = groupName.toLowerCase().includes('claude');
            const category = isClaude ? 'claude' : 'gemini';
            
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
            groupContainer.className = `flex flex-col gap-2 bg-[#f8fafc]/60 dark:bg-[#20293d]/30 border border-slate-100 dark:border-slate-800/30 rounded-lg p-2.5 ${idx > 0 ? 'mt-2' : 'mt-1'}`;
            
            const groupTitle = document.createElement('div');
            groupTitle.className = 'text-[10px] font-bold text-on-surface dark:text-white flex items-center justify-between border-b border-outline-variant/10 pb-1.5 mb-1';
            
            let cooldownBadge = '';
            if (isCategoryCooling) {
                const dateStr = formatCooldownTime(categoryCooldownUntil);
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
                        <div class="h-full ${barColor} rounded-full transition-all duration-700" style="width: ${pct}%"></div>
                    </div>
                    ${resetStr ? `<span class="text-[9px] text-outline/50 mt-0.5">${resetStr}</span>` : ''}
                `;
                groupContainer.appendChild(row);
            });

            containerEl.appendChild(groupContainer);
        });
    } else {
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
                    <div class="h-full ${barColor} rounded-full transition-all duration-700" style="width: ${pct}%"></div>
                </div>
                ${resetStr ? `<span class="text-[9px] text-outline/50 mt-0.5">重置于: ${resetStr}</span>` : ''}
            `;
            containerEl.appendChild(row);
        });
    }
}

// Fetch and load individual account quota
async function loadAccountQuota(accountId, containerEl, refreshBtn, force = false, cooldowns = {}) {
    if (!force && state.quotaCache[accountId]) {
        renderQuotaBars(containerEl, state.quotaCache[accountId], cooldowns);
        updateAggregateQuotaUI();
        return;
    }
    if (refreshBtn) refreshBtn.classList.add('animate-spin');
    if (containerEl) containerEl.innerHTML = '<span class="text-[10px] text-outline/50">加载中...</span>';
    
    try {
        const result = await ipcRenderer.invoke('quota:fetch', accountId);
        if (result.error) {
            if (containerEl) containerEl.innerHTML = `<span class="text-[10px] text-red-400">${result.error}</span>`;
        } else {
            state.quotaCache[accountId] = result.buckets;
            renderQuotaBars(containerEl, result.buckets, cooldowns);
            updateAggregateQuotaUI();
        }
    } catch (e) {
        if (containerEl) containerEl.innerHTML = `<span class="text-[10px] text-red-400">请求失败</span>`;
    } finally {
        if (refreshBtn) refreshBtn.classList.remove('animate-spin');
    }
}

// Render accounts grid UI
function renderAccounts(accounts) {
    state.currentAccountsList = accounts;
    if (!accountsList) return;
    
    const filteredAccounts = accounts.filter(acc => {
        const accountChannel = acc.provider === 'antigravity' ? 'antigravity' : 'project';
        return accountChannel === state.currentViewTab;
    });

    if (accountCountBadge) {
        accountCountBadge.textContent = `共 ${filteredAccounts.length} 个账号`;
    }
    accountsList.innerHTML = '';
    
    if (filteredAccounts.length === 0) {
        if (accountsEmptyState) {
            accountsEmptyState.classList.remove('hidden');
            accountsEmptyState.classList.add('flex');
        }
        accountsList.classList.add('hidden');
        return;
    }
    
    if (accountsEmptyState) {
        accountsEmptyState.classList.add('hidden');
        accountsEmptyState.classList.remove('flex');
    }
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

        const providerBadge = acc.provider === 'antigravity'
            ? '<span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold border border-primary/20 ml-2 mt-0.5 self-center">Antigravity</span>'
            : (acc.provider === 'gemini-cli'
                ? '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300 text-[9px] font-bold border border-outline-variant/30 ml-2 mt-0.5 self-center">Gemini CLI</span>'
                : '');

        const projectBadge = (acc.provider !== 'antigravity' && acc.projectId)
            ? '<span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold border border-emerald-500/20 ml-2 mt-0.5 self-center">Project</span>'
            : '';

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
        
        const totalCategoriesCount = 2;
        const isOverallCooling = coolingCategories.includes('all') || (coolingCategories.length === totalCategoriesCount);

        const statusBadge = document.createElement('div');
        if (isOverallCooling) {
            statusBadge.className = 'flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded text-nowrap self-start flex-shrink-0';
            const dateStr = formatCooldownTime(maxCooldownTime);
            statusBadge.innerHTML = `<span class="material-symbols-outlined text-[12px]">hourglass_empty</span> 冷静中 (${dateStr}恢复)`;
        } else {
            statusBadge.className = 'flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded text-nowrap self-start flex-shrink-0';
            statusBadge.innerHTML = '<span class="material-symbols-outlined text-[12px]">check_circle</span> 有效';
        }
        
        header.appendChild(info);
        header.appendChild(statusBadge);
        
        // ---- AI Credit Section ----
        const creditSection = document.createElement('div');
        creditSection.className = 'flex flex-col gap-1.5 border-t border-outline-variant/20 pt-3';
        
        const creditHeader = document.createElement('div');
        creditHeader.className = 'flex justify-between items-center';
        
        const creditTitle = document.createElement('span');
        creditTitle.className = 'text-[11px] font-semibold text-outline dark:text-outline-variant';
        creditTitle.textContent = 'AI 积分 (AI Credit)';
        
        const creditValue = document.createElement('span');
        creditValue.className = 'text-[11px] font-bold text-on-surface dark:text-white font-data-mono';
        const creditVal = typeof acc.credits === 'number' ? `$${acc.credits.toFixed(2)}` : '未加载';
        creditValue.textContent = creditVal;
        
        creditHeader.appendChild(creditTitle);
        creditHeader.appendChild(creditValue);
        creditSection.appendChild(creditHeader);
        
        // Overages Toggle Button
        const overagesToggleWrapper = document.createElement('div');
        overagesToggleWrapper.className = 'flex items-center justify-between text-[11px] mt-1.5 select-none cursor-pointer';
        
        const overagesSwitchId = `overagesToggle-${acc.id}`;
        const isOveragesChecked = acc.enableOverages === true;
        overagesToggleWrapper.innerHTML = `
            <span class="text-outline dark:text-outline-variant">使用积分抵扣超额度部分</span>
            <div class="relative inline-block w-8 align-middle transition duration-200 ease-in flex-shrink-0 ml-2">
                <input class="toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out" 
                    id="${overagesSwitchId}" type="checkbox" ${isOveragesChecked ? 'checked' : ''}/>
                <label class="toggle-label block overflow-hidden h-4 rounded-full bg-outline-variant/50 dark:bg-white/10 cursor-pointer" for="${overagesSwitchId}"></label>
            </div>
        `;
        
        const overagesCheckbox = overagesToggleWrapper.querySelector('input');
        const overagesLabel = overagesToggleWrapper.querySelector('label');
        
        overagesCheckbox.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            ipcRenderer.send('accounts:toggle-overages', acc.id, enabled);
            acc.enableOverages = enabled;
            if (enabled) {
                overagesCheckbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-primary appearance-none cursor-pointer translate-x-4 transition-transform duration-200 ease-in-out';
                overagesLabel.className = 'toggle-label block overflow-hidden h-4 rounded-full bg-primary cursor-pointer';
            } else {
                overagesCheckbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out';
                overagesLabel.className = 'toggle-label block overflow-hidden h-4 rounded-full bg-outline-variant/50 dark:bg-white/10 cursor-pointer';
            }
            updateAggregateQuotaUI();
        });
        
        if (isOveragesChecked) {
            overagesCheckbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-primary appearance-none cursor-pointer translate-x-4 transition-transform duration-200 ease-in-out';
            overagesLabel.className = 'toggle-label block overflow-hidden h-4 rounded-full bg-primary cursor-pointer';
        } else {
            overagesCheckbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out';
            overagesLabel.className = 'toggle-label block overflow-hidden h-4 rounded-full bg-outline-variant/50 dark:bg-white/10 cursor-pointer';
        }
        
        creditSection.appendChild(overagesToggleWrapper);

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

        refreshBtn.onclick = () => loadAccountQuota(acc.id, quotaBars, refreshBtn, true, acc.cooldowns);

        // ---- Footer ----
        const footer = document.createElement('div');
        footer.className = 'flex justify-between items-center pt-1 border-t border-outline-variant/20';
        
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
        const accLabel = toggleWrapper.querySelector('label');
        const labelText = toggleWrapper.querySelector('span');
        
        checkbox.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            ipcRenderer.send('accounts:toggle-enabled', acc.id, enabled);
            acc.enabled = enabled;
            if (enabled) {
                checkbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-primary appearance-none cursor-pointer translate-x-4 transition-transform duration-200 ease-in-out';
                accLabel.className = 'toggle-label block overflow-hidden h-4 rounded-full bg-primary cursor-pointer';
                labelText.className = 'text-[11px] font-bold text-emerald-500';
                labelText.textContent = '启用中';
                card.classList.remove('opacity-60');
            } else {
                checkbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out';
                accLabel.className = 'toggle-label block overflow-hidden h-4 rounded-full bg-outline-variant/50 dark:bg-white/10 cursor-pointer';
                labelText.className = 'text-[11px] font-bold text-outline';
                labelText.textContent = '已停用';
                card.classList.add('opacity-60');
            }
            updateAggregateQuotaUI();
        });
        
        if (!isChecked) {
            card.classList.add('opacity-60');
            checkbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-outline-variant appearance-none cursor-pointer translate-x-0 transition-transform duration-200 ease-in-out';
            accLabel.className = 'toggle-label block overflow-hidden h-4 rounded-full bg-outline-variant/50 dark:bg-white/10 cursor-pointer';
        } else {
            checkbox.className = 'toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-2 border-primary appearance-none cursor-pointer translate-x-4 transition-transform duration-200 ease-in-out';
            accLabel.className = 'toggle-label block overflow-hidden h-4 rounded-full bg-primary cursor-pointer';
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
        card.appendChild(creditSection);
        card.appendChild(quotaSection);
        card.appendChild(footer);
        accountsList.appendChild(card);

        // Auto-load quota
        loadAccountQuota(acc.id, quotaBars, refreshBtn, false, acc.cooldowns);
    });
}

function updatePoolModeUI() {
    if (!poolModeToggle) return;
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

function updateViewTabUI() {
    if (btnChannelAntigravity && btnChannelProject) {
        if (state.currentViewTab === 'antigravity') {
            btnChannelAntigravity.className = 'px-4 py-1.5 rounded-md font-bold cursor-pointer transition-all duration-200 bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim shadow-sm';
            btnChannelProject.className = 'px-4 py-1.5 rounded-md font-medium cursor-pointer transition-all duration-200 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200';
            
            if (poolModeContainer) poolModeContainer.classList.remove('hidden');
            if (lblPoolMode) lblPoolMode.innerText = '账号负载均衡';
            if (poolModeToggle && state.lastBackendData) {
                poolModeToggle.checked = state.lastBackendData.poolMode;
            }
        } else {
            btnChannelProject.className = 'px-4 py-1.5 rounded-md font-bold cursor-pointer transition-all duration-200 bg-white dark:bg-[#1a1f30] text-primary dark:text-primary-fixed-dim shadow-sm';
            btnChannelAntigravity.className = 'px-4 py-1.5 rounded-md font-medium cursor-pointer transition-all duration-200 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200';
            
            if (poolModeContainer) poolModeContainer.classList.remove('hidden');
            if (lblPoolMode) lblPoolMode.innerText = '项目负载均衡';
            if (poolModeToggle && state.lastBackendData) {
                poolModeToggle.checked = state.lastBackendData.projectPoolMode;
            }
        }
        updatePoolModeUI();
    }

    const btnAntigravityLogin = document.getElementById('btnAntigravityLogin');
    const btnGeminiCliLogin = document.getElementById('btnGeminiCliLogin');
    const btnProjectLogin = document.getElementById('btnProjectLogin');
    
    if (state.currentViewTab === 'antigravity') {
        if (btnAntigravityLogin) btnAntigravityLogin.classList.remove('hidden');
        if (btnGeminiCliLogin) btnGeminiCliLogin.classList.remove('hidden');
        if (btnProjectLogin) btnProjectLogin.classList.add('hidden');
    } else {
        if (btnAntigravityLogin) btnAntigravityLogin.classList.add('hidden');
        if (btnGeminiCliLogin) btnGeminiCliLogin.classList.add('hidden');
        if (btnProjectLogin) btnProjectLogin.classList.remove('hidden');
    }
}

function updateAggregateQuotaUI() {
    const panel = document.getElementById('aggregate-quota-panel');
    const grid = document.getElementById('aggregate-quota-grid');
    const info = document.getElementById('aggregate-quota-info');
    if (!panel || !grid || !info) return;

    const isPool = poolModeToggle ? poolModeToggle.checked : false;
    if (!isPool || !state.currentAccountsList || state.currentAccountsList.length === 0) {
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

    if (state.currentActiveChannel === 'project') {
        categories = categories.filter(c => c.key === 'gemini_weekly');
    }

    const sums = {
        gemini_weekly: { sum: 0, count: 0 },
        gemini_5hour: { sum: 0, count: 0 },
        claude_weekly: { sum: 0, count: 0 },
        claude_5hour: { sum: 0, count: 0 }
    };

    const enabledAccounts = state.currentAccountsList.filter(a => {
        const accountChannel = a.provider === 'antigravity' ? 'antigravity' : 'project';
        return accountChannel === state.currentActiveChannel && a.enabled !== false;
    });

    enabledAccounts.forEach(acc => {
        const buckets = state.quotaCache[acc.id];
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
    
    Object.keys(state.quotaCache).forEach(accId => {
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

async function refreshAllQuotas() {
    if (state.isRefreshingAll) return;
    state.isRefreshingAll = true;

    if (btnRefreshAllIcon && btnRefreshAllQuota) {
        btnRefreshAllIcon.classList.add('animate-spin');
        btnRefreshAllQuota.disabled = true;
        btnRefreshAllQuota.classList.add('opacity-60', 'cursor-not-allowed');
    }

    try {
        const cardRefreshBtns = accountsList ? accountsList.querySelectorAll('[data-quota-refresh-btn]') : [];
        if (cardRefreshBtns.length === 0) {
            state.quotaCache = {};
            const accounts = await ipcRenderer.invoke('accounts:list');
            renderAccounts(accounts);
        } else {
            for (const btn of cardRefreshBtns) {
                btn.click();
                await new Promise(r => setTimeout(r, 200));
            }
        }
    } finally {
        await new Promise(r => setTimeout(r, 800));
        if (btnRefreshAllIcon && btnRefreshAllQuota) {
            btnRefreshAllIcon.classList.remove('animate-spin');
            btnRefreshAllQuota.disabled = false;
            btnRefreshAllQuota.classList.remove('opacity-60', 'cursor-not-allowed');
        }
        state.isRefreshingAll = false;
    }
}

async function refreshAllAccountsQuotas() {
    if (state.isRefreshingAggregate || !state.currentAccountsList || state.currentAccountsList.length === 0) return;
    state.isRefreshingAggregate = true;

    if (btnRefreshAggregateQuota && btnRefreshAggregateIcon) {
        btnRefreshAggregateIcon.classList.add('animate-spin');
        btnRefreshAggregateQuota.disabled = true;
        btnRefreshAggregateQuota.classList.add('opacity-60', 'cursor-not-allowed');
    }

    try {
        for (const acc of state.currentAccountsList) {
            try {
                const result = await ipcRenderer.invoke('quota:fetch', acc.id);
                if (result && !result.error) {
                    state.quotaCache[acc.id] = result.buckets;
                }
            } catch (err) {
                console.error(`Failed to refresh quota for ${acc.email}:`, err);
            }
            await new Promise(r => setTimeout(r, 100));
        }
        updateAggregateQuotaUI();
        if (accountsList && accountsList.children.length > 0) {
            renderAccounts(state.currentAccountsList);
        }
    } finally {
        state.isRefreshingAggregate = false;
        if (btnRefreshAggregateQuota && btnRefreshAggregateIcon) {
            btnRefreshAggregateIcon.classList.remove('animate-spin');
            btnRefreshAggregateQuota.disabled = false;
            btnRefreshAggregateQuota.classList.remove('opacity-60', 'cursor-not-allowed');
        }
    }
}

// Google OAuth dialog flow
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
                    <div class="text-[12px] text-outline leading-relaxed bg-slate-50 dark:bg-white/5 p-3.5 rounded-xl border border-outline-variant/20 flex flex-col gap-2.5">
                        <p>1. 点击下方按钮复制链接并在浏览器中打开，完成 Google 账户授权：</p>
                        <button id="flowOpenAuthLink" type="button" disabled class="w-full py-2.5 bg-slate-100 dark:bg-white/5 text-outline rounded-lg transition-all font-semibold text-[12px] border border-outline-variant/20 flex items-center justify-center gap-1.5 opacity-50 cursor-not-allowed">
                            <span class="material-symbols-outlined text-[14px] animate-spin">refresh</span>
                            正在获取官方授权链接...
                        </button>
                    </div>

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

// Start Google account pool login
async function startLogin(provider) {
    if (state.isLoadingAuth) return;
    state.isLoadingAuth = true;
    if (addAccountDropdown) addAccountDropdown.classList.add('hidden');

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
        state.isLoadingAuth = false;
        btnAddAccount.innerHTML = origText;
        btnAddAccount.classList.remove('opacity-70', 'cursor-not-allowed');
    }
}

// Start Project binding login
async function startProjectLogin() {
    if (addAccountDropdown) addAccountDropdown.classList.add('hidden');
    if (state.isLoadingAuth) return;
    state.isLoadingAuth = true;
    
    const origText = btnAddAccount.innerHTML;
    btnAddAccount.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin">refresh</span> 登录中...';
    btnAddAccount.classList.add('opacity-70', 'cursor-not-allowed');

    try {
        const result = await showOneStopAuthModal();
        if (result && result.success) {
            // Callback or action after successful GCP project link (account list will automatically trigger res)
        }
    } catch (err) {
        alert('登录发生错误: ' + err.message);
    } finally {
        state.isLoadingAuth = false;
        btnAddAccount.innerHTML = origText;
        btnAddAccount.classList.remove('opacity-70', 'cursor-not-allowed');
    }
}

// Global window registration for DOM inline click events
window.startLogin = startLogin;
window.startProjectLogin = startProjectLogin;

// Initialize account pool controls and bindings
function initAccountsEvents() {
    btnAddAccount = document.getElementById('btnAddAccount');
    addAccountDropdown = document.getElementById('addAccountDropdown');
    poolModeToggle = document.getElementById('poolModeToggle');
    accountsList = document.getElementById('accountsList');
    accountsEmptyState = document.getElementById('accountsEmptyState');
    accountCountBadge = document.getElementById('accountCountBadge');
    btnRefreshAllQuota = document.getElementById('btnRefreshAllQuota');
    btnRefreshAllIcon = document.getElementById('btnRefreshAllIcon');
    btnClearSessions = document.getElementById('btnClearSessions');
    btnRefreshAggregateQuota = document.getElementById('btnRefreshAggregateQuota');
    btnRefreshAggregateIcon = document.getElementById('btnRefreshAggregateIcon');
    poolModeContainer = document.getElementById('poolModeContainer');
    lblPoolMode = document.getElementById('lblPoolMode');
    btnChannelAntigravity = document.getElementById('btnChannelAntigravity');
    btnChannelProject = document.getElementById('btnChannelProject');
    btnExportAccounts = document.getElementById('btnExportAccounts');
    btnImportAccounts = document.getElementById('btnImportAccounts');

    if (btnRefreshAllQuota) {
        btnRefreshAllQuota.addEventListener('click', refreshAllQuotas);
    }
    if (btnRefreshAggregateQuota) {
        btnRefreshAggregateQuota.addEventListener('click', refreshAllAccountsQuotas);
    }

    if (btnClearSessions) {
        btnClearSessions.addEventListener('click', async () => {
            const icon = btnClearSessions.querySelector('.material-symbols-outlined');
            const label = btnClearSessions.querySelector('span:last-child');
            const origLabel = label.textContent;
            
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

    if (btnAddAccount && addAccountDropdown) {
        btnAddAccount.addEventListener('click', () => {
            if (state.isLoadingAuth) return;
            addAccountDropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!btnAddAccount.contains(e.target) && !addAccountDropdown.contains(e.target)) {
                addAccountDropdown.classList.add('hidden');
            }
        });
    }

    // Dynamic project-based button appending
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

    if (poolModeToggle) {
        poolModeToggle.addEventListener('change', (e) => {
            if (state.currentViewTab === 'project') {
                ipcRenderer.send('pool:toggle-project', e.target.checked);
            } else {
                ipcRenderer.send('pool:toggle', e.target.checked);
            }
            updatePoolModeUI();
            updateAggregateQuotaUI();
        });
    }

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

    if (btnChannelAntigravity) {
        btnChannelAntigravity.addEventListener('click', () => {
            state.currentViewTab = 'antigravity';
            ipcRenderer.send('channel:switch', 'antigravity');
            updateViewTabUI();
            if (state.currentAccountsList) {
                renderAccounts(state.currentAccountsList);
            }
            updateAggregateQuotaUI();
        });
    }
    if (btnChannelProject) {
        btnChannelProject.addEventListener('click', () => {
            state.currentViewTab = 'project';
            ipcRenderer.send('channel:switch', 'project');
            updateViewTabUI();
            if (state.currentAccountsList) {
                renderAccounts(state.currentAccountsList);
            }
            updateAggregateQuotaUI();
        });
    }
}

// Register shared callbacks
state.callbacks.renderAccounts = renderAccounts;
state.callbacks.updateAggregateQuotaUI = updateAggregateQuotaUI;

module.exports = {
    getRelativeResetTime,
    formatCooldownTime,
    renderQuotaBars,
    loadAccountQuota,
    renderAccounts,
    updatePoolModeUI,
    updateViewTabUI,
    updateAggregateQuotaUI,
    refreshAllQuotas,
    refreshAllAccountsQuotas,
    initAccountsEvents
};
