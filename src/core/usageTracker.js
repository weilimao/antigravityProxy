const fs = require('fs');
const path = require('path');
const { calculateCostBreakdown } = require('./pricing');

const FILE_NAME = 'usage.json';

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
    return parseFloat(Math.max(0, value || 0).toFixed(6));
}

function createZeroStats() {
    return {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cacheHitRequests: 0,
        inputCost: 0,
        outputCost: 0,
        cachedCost: 0,
        totalCost: 0
    };
}

function createEmptyState() {
    return {
        updatedAt: null,
        totals: createZeroStats(),
        accounts: {}
    };
}

function getAccountKey(account) {
    if (!account) return 'direct';
    if (typeof account === 'string') return account.trim() || 'direct';
    if (account.id) return String(account.id);
    if (account.accountId) return String(account.accountId);
    if (account.email) {
        return `${account.email}:${account.provider || 'unknown'}`;
    }
    return 'direct';
}

function getAccountLabel(account) {
    if (!account) return 'Direct';
    if (typeof account === 'string') return account.trim() || 'Direct';
    return account.email || account.accountName || account.accountId || 'Direct';
}

function getAccountMeta(account) {
    if (!account || typeof account === 'string') {
        return {
            id: getAccountKey(account),
            email: getAccountLabel(account),
            provider: 'direct'
        };
    }
    return {
        id: getAccountKey(account),
        email: getAccountLabel(account),
        provider: account.provider || 'direct',
        projectId: account.projectId || account.project_id || null,
        scopeType: account.scopeType || null
    };
}

function ensureBucket(parent, key, meta) {
    if (!parent[key]) {
        parent[key] = {
            accountId: meta.id,
            email: meta.email,
            provider: meta.provider || 'direct',
            projectId: meta.projectId || null,
            scopeType: meta.scopeType || null,
            ...createZeroStats(),
            lastUsedAt: null,
            models: {}
        };
    } else {
        parent[key].email = meta.email || parent[key].email;
        parent[key].provider = meta.provider || parent[key].provider;
        parent[key].projectId = meta.projectId || parent[key].projectId || null;
        parent[key].scopeType = meta.scopeType || parent[key].scopeType || null;
    }
    return parent[key];
}

function ensureModelBucket(accountBucket, modelName) {
    const key = (modelName || 'unknown').trim() || 'unknown';
    if (!accountBucket.models[key]) {
        accountBucket.models[key] = {
            model: key,
            ...createZeroStats(),
            lastUsedAt: null
        };
    }
    return accountBucket.models[key];
}

class UsageTracker {
    constructor() {
        this.persistPath = '';
        this.state = createEmptyState();
        this.saveTimeout = null;
    }

    init(userDataPath) {
        this.persistPath = path.join(userDataPath, FILE_NAME);
        this.loadFromDisk();
    }

    updatePath(newPath) {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
            this.saveToDisk();
        }
        this.persistPath = path.join(newPath, FILE_NAME);
        this.loadFromDisk();
    }

    recordUsage(sample = {}) {
        const modelName = (sample.modelName || sample.model || 'unknown').trim() || 'unknown';
        if (modelName === 'unknown') return;

        const inTokens = Math.max(0, Math.floor(toNumber(sample.inTokens)));
        const outTokens = Math.max(0, Math.floor(toNumber(sample.outTokens)));
        const cachedTokens = Math.max(0, Math.floor(toNumber(sample.cachedTokens)));
        const accountMeta = getAccountMeta(sample.account);
        const accountBucket = ensureBucket(this.state.accounts, accountMeta.id, accountMeta);
        const modelBucket = ensureModelBucket(accountBucket, modelName);
        const breakdown = calculateCostBreakdown(modelName, inTokens, outTokens, cachedTokens);
        const cacheHit = cachedTokens > 0 ? 1 : 0;
        const now = sample.timestamp || new Date().toISOString();

        accountBucket.requestCount += 1;
        accountBucket.inputTokens += inTokens;
        accountBucket.outputTokens += outTokens;
        accountBucket.cachedTokens += cachedTokens;
        accountBucket.cacheHitRequests += cacheHit;
        accountBucket.inputCost = roundMoney(accountBucket.inputCost + breakdown.inputCost);
        accountBucket.outputCost = roundMoney(accountBucket.outputCost + breakdown.outputCost);
        accountBucket.cachedCost = roundMoney(accountBucket.cachedCost + breakdown.cachedCost);
        accountBucket.totalCost = roundMoney(accountBucket.totalCost + breakdown.totalCost);
        accountBucket.lastUsedAt = now;

        modelBucket.requestCount += 1;
        modelBucket.inputTokens += inTokens;
        modelBucket.outputTokens += outTokens;
        modelBucket.cachedTokens += cachedTokens;
        modelBucket.cacheHitRequests += cacheHit;
        modelBucket.inputCost = roundMoney(modelBucket.inputCost + breakdown.inputCost);
        modelBucket.outputCost = roundMoney(modelBucket.outputCost + breakdown.outputCost);
        modelBucket.cachedCost = roundMoney(modelBucket.cachedCost + breakdown.cachedCost);
        modelBucket.totalCost = roundMoney(modelBucket.totalCost + breakdown.totalCost);
        modelBucket.lastUsedAt = now;

        this.state.totals.requestCount += 1;
        this.state.totals.inputTokens += inTokens;
        this.state.totals.outputTokens += outTokens;
        this.state.totals.cachedTokens += cachedTokens;
        this.state.totals.cacheHitRequests += cacheHit;
        this.state.totals.inputCost = roundMoney(this.state.totals.inputCost + breakdown.inputCost);
        this.state.totals.outputCost = roundMoney(this.state.totals.outputCost + breakdown.outputCost);
        this.state.totals.cachedCost = roundMoney(this.state.totals.cachedCost + breakdown.cachedCost);
        this.state.totals.totalCost = roundMoney(this.state.totals.totalCost + breakdown.totalCost);
        this.state.updatedAt = now;

        this.scheduleSave();
    }

    getPayload() {
        return this.state;
    }

    scheduleSave() {
        if (this.saveTimeout) return;
        this.saveTimeout = setTimeout(() => {
            this.saveToDisk();
            this.saveTimeout = null;
        }, 3000);
    }

    saveToDisk() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        if (!this.persistPath) return;
        try {
            const data = {
                usage: this.state
            };
            fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('[UsageTracker] Failed to save usage stats:', e);
        }
    }

    loadFromDisk() {
        if (!this.persistPath || !fs.existsSync(this.persistPath)) {
            this.state = createEmptyState();
            return;
        }

        try {
            const raw = fs.readFileSync(this.persistPath, 'utf8');
            const parsed = JSON.parse(raw);
            const usage = parsed.usage || parsed;

            if (!usage || typeof usage !== 'object') {
                this.state = createEmptyState();
                return;
            }

            this.state = createEmptyState();
            this.state.updatedAt = usage.updatedAt || null;

            if (usage.totals) {
                this.state.totals = {
                    ...createZeroStats(),
                    ...usage.totals
                };
            }

            if (usage.accounts && typeof usage.accounts === 'object') {
                for (const [accountKey, accountValue] of Object.entries(usage.accounts)) {
                    const accountMeta = {
                        id: accountValue.accountId || accountKey,
                        email: accountValue.email || accountKey,
                        provider: accountValue.provider || 'direct',
                        projectId: accountValue.projectId || null,
                        scopeType: accountValue.scopeType || null
                    };
                    const accountBucket = ensureBucket(this.state.accounts, accountKey, accountMeta);
                    Object.assign(accountBucket, {
                        ...createZeroStats(),
                        ...accountValue,
                        models: {}
                    });
                    accountBucket.accountId = accountMeta.id;
                    accountBucket.email = accountMeta.email;
                    accountBucket.provider = accountMeta.provider;
                    accountBucket.projectId = accountMeta.projectId;
                    accountBucket.scopeType = accountMeta.scopeType;

                    if (accountValue.models && typeof accountValue.models === 'object') {
                        for (const [modelKey, modelValue] of Object.entries(accountValue.models)) {
                            accountBucket.models[modelKey] = {
                                model: modelValue.model || modelKey,
                                ...createZeroStats(),
                                ...modelValue
                            };
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[UsageTracker] Failed to load usage stats, resetting:', e);
            this.state = createEmptyState();
        }
    }
}

module.exports = new UsageTracker();
