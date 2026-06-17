const PANEL_ID = 'usageStatsPanel';

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatNumber(value) {
    const n = Number(value) || 0;
    return n.toLocaleString();
}

function formatMoney(value) {
    return `$${(Number(value) || 0).toFixed(4)}`;
}

function formatHitRate(tokens, cachedTokens, requests, cacheHitRequests) {
    const tokenRate = tokens > 0 ? (cachedTokens / tokens) * 100 : 0;
    const requestRate = requests > 0 ? (cacheHitRequests / requests) * 100 : 0;
    return `${tokenRate.toFixed(1)}% / ${requestRate.toFixed(1)}%`;
}

function getToneClasses(tone) {
    switch (tone) {
        case 'primary':
            return 'text-primary dark:text-primary-fixed-dim';
        case 'emerald':
            return 'text-emerald-600 dark:text-emerald-400';
        case 'amber':
            return 'text-amber-600 dark:text-amber-400';
        default:
            return 'text-slate-600 dark:text-slate-300';
    }
}

function sortUsageItems(items) {
    return [...items].sort((a, b) => {
        const costDelta = (Number(b.totalCost) || 0) - (Number(a.totalCost) || 0);
        if (costDelta !== 0) return costDelta;
        return (Number(b.requestCount) || 0) - (Number(a.requestCount) || 0);
    });
}

function sortModelsByTokens(items) {
    return [...items].sort((a, b) => {
        const totalA = (Number(a.inputTokens) || 0) + (Number(a.outputTokens) || 0);
        const totalB = (Number(b.inputTokens) || 0) + (Number(b.outputTokens) || 0);
        if (totalB !== totalA) return totalB - totalA;
        return (Number(b.requestCount) || 0) - (Number(a.requestCount) || 0);
    });
}

function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    const host = document.getElementById('view-accounts');
    if (!host) return null;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'hidden';
    host.appendChild(panel);
    return panel;
}

function renderSummaryChip(label, value, tone = 'slate') {
    return `
        <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-[10px] uppercase tracking-normal text-outline dark:text-outline-variant">${escapeHtml(label)}</span>
            <span class="text-[13px] font-bold ${getToneClasses(tone)}">${escapeHtml(value)}</span>
        </div>
    `;
}

function renderModelRows(models) {
    const sorted = sortModelsByTokens(Object.values(models || {}));
    if (sorted.length === 0) {
        return '<tr><td colspan="10" class="px-3 py-3 text-center text-[12px] text-outline dark:text-outline-variant">暂无模型用量</td></tr>';
    }

    return sorted.map(model => {
        return `
            <tr class="border-b border-outline-variant/10 dark:border-white/5">
                <td class="px-3 py-2 font-semibold text-on-surface dark:text-white">${escapeHtml(model.model || 'unknown')}</td>
                <td class="px-3 py-2 text-right">${formatNumber(model.requestCount)}</td>
                <td class="px-3 py-2 text-right text-outline dark:text-outline-variant">${formatNumber(model.inputTokens)}</td>
                <td class="px-3 py-2 text-right text-on-surface dark:text-white">${formatNumber(model.outputTokens)}</td>
                <td class="px-3 py-2 text-right text-slate-500 dark:text-slate-400">${formatNumber(model.cachedTokens)}</td>
                <td class="px-3 py-2 text-right">${formatHitRate(model.inputTokens || 0, model.cachedTokens || 0, model.requestCount || 0, model.cacheHitRequests || 0)}</td>
                <td class="px-3 py-2 text-right text-amber-600 dark:text-amber-400 font-semibold">${formatMoney(model.inputCost)}</td>
                <td class="px-3 py-2 text-right text-sky-600 dark:text-sky-400 font-semibold">${formatMoney(model.outputCost)}</td>
                <td class="px-3 py-2 text-right text-violet-600 dark:text-violet-400 font-semibold">${formatMoney(model.cachedCost)}</td>
                <td class="px-3 py-2 text-right text-primary dark:text-primary-fixed-dim font-bold">${formatMoney(model.totalCost)}</td>
            </tr>
        `;
    }).join('');
}

function renderAccountBlock(account) {
    const models = sortModelsByTokens(Object.values(account.models || {}));
    const tokens = (Number(account.inputTokens) || 0) + (Number(account.outputTokens) || 0);
    const provider = account.provider || 'direct';
    const badgeClass = provider === 'antigravity'
        ? 'bg-primary/10 text-primary border-primary/20'
        : provider === 'project'
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
            : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300 border-outline-variant/30';

    return `
        <details class="group border border-outline-variant/25 rounded-xl overflow-hidden bg-white dark:bg-[#1a1f30]">
            <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-white/5">
                <div class="min-w-0 flex items-center gap-2">
                    <span class="text-[13px] font-bold text-on-surface dark:text-white truncate" title="${escapeHtml(account.email || account.accountId || 'Direct')}">${escapeHtml(account.email || account.accountId || 'Direct')}</span>
                    <span class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${badgeClass}">${escapeHtml(provider)}</span>
                </div>
                <div class="flex flex-wrap justify-end gap-3 text-right text-[11px] min-w-0">
                    <div class="flex flex-col">
                        <span class="text-outline dark:text-outline-variant">调用</span>
                        <span class="font-bold text-on-surface dark:text-white">${formatNumber(account.requestCount)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-outline dark:text-outline-variant">Tokens</span>
                        <span class="font-bold text-on-surface dark:text-white">${formatNumber(tokens)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-outline dark:text-outline-variant">缓存</span>
                        <span class="font-bold text-on-surface dark:text-white">${formatNumber(account.cachedTokens)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-outline dark:text-outline-variant">命中率</span>
                        <span class="font-bold text-on-surface dark:text-white">${formatHitRate(account.inputTokens || 0, account.cachedTokens || 0, account.requestCount || 0, account.cacheHitRequests || 0)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-outline dark:text-outline-variant">输入成本</span>
                        <span class="font-bold text-amber-600 dark:text-amber-400">${formatMoney(account.inputCost)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-outline dark:text-outline-variant">输出成本</span>
                        <span class="font-bold text-sky-600 dark:text-sky-400">${formatMoney(account.outputCost)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-outline dark:text-outline-variant">缓存成本</span>
                        <span class="font-bold text-violet-600 dark:text-violet-400">${formatMoney(account.cachedCost)}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-outline dark:text-outline-variant">总成本</span>
                        <span class="font-bold text-primary dark:text-primary-fixed-dim">${formatMoney(account.totalCost)}</span>
                    </div>
                </div>
            </summary>
            <div class="border-t border-outline-variant/20 bg-slate-50/40 dark:bg-white/5">
                <div class="overflow-x-auto">
                    <table class="w-full text-left table-fixed border-collapse">
                        <thead>
                            <tr class="border-b border-outline-variant/40">
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider">模型</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">调用</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">输入</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">输出</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">缓存</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">命中率</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">输入成本</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">输出成本</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">缓存成本</th>
                                <th class="px-3 py-2 text-[10px] font-bold text-outline uppercase tracking-wider text-right">总成本</th>
                            </tr>
                        </thead>
                        <tbody class="text-[12px] font-data-mono text-on-surface dark:text-white">
                            ${renderModelRows(account.models)}
                        </tbody>
                    </table>
                </div>
            </div>
        </details>
    `;
}

function render(usage) {
    const panel = ensurePanel();
    if (!panel) return;

    const accounts = usage && usage.accounts ? Object.values(usage.accounts) : [];
    if (accounts.length === 0) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }

    const totals = usage.totals || {};
    const sortedAccounts = sortUsageItems(accounts);
    const tokenHits = totals.inputTokens > 0 ? (totals.cachedTokens / totals.inputTokens) * 100 : 0;
    const requestHits = totals.requestCount > 0 ? (totals.cacheHitRequests / totals.requestCount) * 100 : 0;

    panel.classList.remove('hidden');
    panel.innerHTML = `
        <div class="glass-card rounded-xl p-4 flex flex-col gap-3 border border-outline-variant/30">
            <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <div class="text-[14px] font-bold text-on-surface dark:text-white">账号用量详情</div>
                    <div class="text-[11px] text-outline dark:text-outline-variant mt-1">按账号与模型展开统计输入、输出、缓存 token 与成本</div>
                </div>
                <div class="flex items-center gap-4 text-right">
                    ${renderSummaryChip('账号', String(sortedAccounts.length), 'primary')}
                    ${renderSummaryChip('调用', formatNumber(totals.requestCount), 'slate')}
                    ${renderSummaryChip('总成本', formatMoney(totals.totalCost), 'emerald')}
                    ${renderSummaryChip('命中率', `${tokenHits.toFixed(1)}% / ${requestHits.toFixed(1)}%`, 'amber')}
                </div>
            </div>
            <div class="flex flex-col gap-3">
                ${sortedAccounts.map(renderAccountBlock).join('')}
            </div>
        </div>
    `;
}

function init() {
    ensurePanel();
}

module.exports = {
    init,
    render
};
