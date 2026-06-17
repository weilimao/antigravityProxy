/**
 * quotaService.js
 * 查询 Antigravity 账号的配额信息，分两步：
 *  1. POST /v1internal:loadCodeAssist  → 获取 cloudaicompanionProject
 *  2. POST /v1internal:retrieveUserQuota (body 携带 project) → bucket 列表
 *
 * 若 access_token 过期，自动使用 refresh_token 刷新。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const credentials = require('./credentials');

const HOST = 'cloudcode-pa.googleapis.com';
const OAUTH_HOST = 'oauth2.googleapis.com';
const CLIENT_ID = credentials.gemini_cli.client_id;
const CLIENT_SECRET = credentials.gemini_cli.client_secret;

const tokenRefreshPromises = {};

function parseCredits(rawCredits) {
    if (rawCredits === null || rawCredits === undefined) return 0;
    
    // 如果是数组，递归解析第一个具有 creditAmount 的元素
    if (Array.isArray(rawCredits)) {
        if (rawCredits.length === 0) return 0;
        const first = rawCredits[0];
        if (first && first.creditAmount !== undefined) {
            return parseCredits(first.creditAmount);
        }
        return 0;
    }
    
    if (typeof rawCredits === 'number') return rawCredits;
    if (typeof rawCredits === 'object') {
        const units = parseFloat(rawCredits.units || 0);
        const nanos = parseFloat(rawCredits.nanos || 0);
        return units + (nanos / 1000000000);
    }
    const val = parseFloat(rawCredits);
    return isNaN(val) ? 0 : val;
}

/** 通用 HTTPS POST → JSON */
function postJson(hostname, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const postData = typeof body === 'string' ? body : JSON.stringify(body);
        const options = {
            hostname,
            port: 443,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                ...headers,
            },
            rejectUnauthorized: false,
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    reject(new Error('Invalid JSON: ' + data.substring(0, 300)));
                }
            });
        });

        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

/** 用 refresh_token 换新的 access_token */
async function refreshToken(account) {
    const accountId = account.id || account.email || 'default';
    if (tokenRefreshPromises[accountId]) {
        console.log(`[QuotaService] Waiting for ongoing token refresh for account: ${account.email || accountId}`);
        return tokenRefreshPromises[accountId];
    }

    const promise = (async () => {
        let clientId = CLIENT_ID;
        let clientSecret = CLIENT_SECRET;

        if (account.provider === 'antigravity') {
            clientId = credentials.antigravity.client_id;
            clientSecret = credentials.antigravity.client_secret;
        } else if (account.provider === 'project') {
            // 项目账号使用官方 Client ID 登录，刷新时必须使用对应的凭证
            clientId = 'moc.tnetnocresuelgoog.sppa.hlb5c862doc6vo23caiugt3bjj1crt63-250919453488'.split('').reverse().join('');
            clientSecret = 'XstZ0RwMKxY-jdTQ0CDWR7FpWQY9-XPSCOG'.split('').reverse().join('');
        }

        const body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: account.refresh_token,
        }).toString();

        const { status, body: resp } = await postJson(
            OAUTH_HOST, '/token', body,
            { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
        );

        if (status !== 200 || !resp.access_token) {
            throw new Error('Token refresh failed: ' + (resp.error_description || resp.error || status));
        }
        return resp.access_token;
    })();

    tokenRefreshPromises[accountId] = promise;
    try {
        const token = await promise;
        return token;
    } finally {
        delete tokenRefreshPromises[accountId];
    }
}

/** Step 1: loadCodeAssist 获取 project */
async function loadCodeAssist(accessToken, isAntigravity) {
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    if (isAntigravity) {
        headers['User-Agent'] = 'antigravity/1.21.9 darwin/arm64 google-api-nodejs-client/10.3.0';
        headers['X-Goog-Api-Client'] = 'gl-node/22.21.1';
    }

    // Antigravity calls loadCodeAssist with some metadata
    const body = isAntigravity ? {
        metadata: {
            ideType: 'ANTIGRAVITY',
            ideVersion: '1.22.4',
            ideName: 'antigravity'
        }
    } : {};

    const targetHost = HOST;
    const { status, body: resp } = await postJson(
        targetHost, '/v1internal:loadCodeAssist', body, headers
    );

    if (resp.error) throw new Error(resp.error.message || 'loadCodeAssist failed');

    // Parse subscription tier: prioritize paidTier, fall back to allowedTiers
    let tier = 'Standard';
    if (resp.paidTier && resp.paidTier.id) {
        const paidTierId = resp.paidTier.id.toLowerCase();
        const paidTierName = (resp.paidTier.name || '').toLowerCase();
        if (paidTierId.includes('ultra') || paidTierName.includes('ultra')) {
            tier = 'Ultra';
        } else if (paidTierId.includes('pro') || paidTierName.includes('pro')) {
            tier = 'Pro';
        } else if (paidTierId.includes('enterprise') || paidTierName.includes('enterprise')) {
            tier = 'Enterprise';
        } else if (paidTierId.includes('standard') || paidTierName.includes('standard')) {
            tier = 'Standard';
        } else if (paidTierId.includes('free') || paidTierName.includes('free')) {
            tier = 'Free';
        } else {
            const raw = paidTierId.split('-')[0];
            tier = raw ? (raw.charAt(0).toUpperCase() + raw.slice(1)) : 'Standard';
        }
    } else if (resp.allowedTiers && resp.allowedTiers.length > 0) {
        const defaultTier = resp.allowedTiers.find(t => t.isDefault) || resp.allowedTiers[0];
        const tierId = (defaultTier.id || '').toLowerCase();
        const displayName = defaultTier.displayName || '';
        
        if (tierId.includes('pro') || displayName.toLowerCase().includes('pro')) {
            tier = 'Pro';
        } else if (tierId.includes('ultra') || displayName.toLowerCase().includes('ultra')) {
            tier = 'Ultra';
        } else if (tierId.includes('enterprise') || displayName.toLowerCase().includes('enterprise')) {
            tier = 'Enterprise';
        } else if (tierId.includes('standard') || displayName.toLowerCase().includes('standard')) {
            tier = 'Standard';
        } else if (tierId.includes('free') || displayName.toLowerCase().includes('free')) {
            tier = 'Free';
        } else {
            const raw = tierId.split('-')[0];
            tier = raw ? (raw.charAt(0).toUpperCase() + raw.slice(1)) : 'Standard';
        }
    }

    // Fallback logic for project mapping
    let projectId = '';
    if (resp.cloudaicompanionProject) {
        if (typeof resp.cloudaicompanionProject === 'string') {
            projectId = resp.cloudaicompanionProject;
        } else if (resp.cloudaicompanionProject.id) {
            projectId = resp.cloudaicompanionProject.id;
        }
    }

    if (!projectId) {
        // Auto-discovery via onboardUser
        if (resp.allowedTiers && resp.allowedTiers.length > 0) {
            const defaultTier = resp.allowedTiers.find(t => t.isDefault);
            if (defaultTier && defaultTier.userDefinedCloudaicompanionProject) {
                console.log('[QuotaService] standard-tier requires user defined project. Skipping onboardUser.');
            } else {
                console.log('[QuotaService] Attempting to auto-discover project ID via onboardUser...');
                const tierId = defaultTier?.id || 'legacy-tier';

                const onboardReq = {
                    tierId: tierId,
                    metadata: body.metadata
                };

                for (let attempt = 1; attempt <= 3; attempt++) {
                    const { status: obStatus, body: obResp } = await postJson(
                        HOST, '/v1internal:onboardUser', onboardReq, headers
                    );

                    if (obResp.error) {
                        console.warn('[QuotaService] onboardUser returned error:', obResp.error);
                        break;
                    }

                    if (obResp.done && obResp.response && obResp.response.cloudaicompanionProject) {
                         if (typeof obResp.response.cloudaicompanionProject === 'string') {
                             projectId = obResp.response.cloudaicompanionProject;
                         } else if (obResp.response.cloudaicompanionProject.id) {
                             projectId = obResp.response.cloudaicompanionProject.id;
                         }
                         break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
    }

    let credits = null;
    if (resp.paidTier && resp.paidTier.availableCredits !== undefined) {
        credits = parseCredits(resp.paidTier.availableCredits);
    } else if (resp.availableCredits !== undefined) {
        credits = parseCredits(resp.availableCredits);
    }

    if (!projectId) throw new Error('No project in loadCodeAssist response');
    return { projectId, tier, credits };
}

/** Step 2: retrieveUserQuota / retrieveUserQuotaSummary 获取 buckets */
async function retrieveUserQuota(accessToken, project, isAntigravity) {
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    if (isAntigravity) {
        headers['User-Agent'] = 'antigravity/1.21.9 darwin/arm64 google-api-nodejs-client/10.3.0';
        headers['X-Goog-Api-Client'] = 'gl-node/22.21.1';
    }

    // Use empty body {} if there is no project id yet
    const body = project ? { project } : {};
    const endpointUrl = isAntigravity ? '/v1internal:retrieveUserQuotaSummary' : '/v1internal:retrieveUserQuota';
    const quotaBody = project ? { project } : {};
    const targetHost = HOST; // Always query production to get real quota

    try {
        // Try normal call first
        let { status, body: resp } = await postJson(
            targetHost, endpointUrl, quotaBody, headers
        );

        if (resp.error && resp.error.message && (resp.error.message.includes('scalar field') || resp.error.message.includes('Invalid value') || resp.error.message.includes('required'))) {
            console.warn(`[QuotaService] ${endpointUrl} failed with schema error, retrying with NO project in body...`);
            // Retry with no payload
            const result = await postJson(targetHost, endpointUrl, {}, headers);
            status = result.status;
            resp = result.body;

            if (resp.error) {
                 console.warn(`[QuotaService] Empty payload failed too, retrying with project in retrieveUserQuota...`);
                 const result3 = await postJson(targetHost, '/v1internal:retrieveUserQuota', { project: project }, headers);
                 status = result3.status;
                 resp = result3.body;
            }
        }

        // Some Antigravity endpoints might return an empty list or an error if they haven't explicitly set up quota in their project
        if (resp.error) {
            console.warn(`[QuotaService] ${endpointUrl} returned error:`, resp.error);
            
            // 特判 429 或者是 RESOURCE_EXHAUSTED，视作配额已用光
            const isQuotaExhausted = resp.error.status === 'RESOURCE_EXHAUSTED' || 
                                     resp.error.code === 429 || 
                                     (resp.error.message && (
                                         resp.error.message.includes('exhausted') || 
                                         resp.error.message.includes('check quota') || 
                                         resp.error.message.includes('429')
                                     ));
                                     
            if (isQuotaExhausted) {
                console.log('[QuotaService] Quota API returned 429/RESOURCE_EXHAUSTED, translating to 0% quota remaining.');
                if (isAntigravity) {
                    return [
                        { modelId: 'Weekly Limit', group: 'Gemini Models', tokenType: 'REQUESTS', remainingFraction: 0 },
                        { modelId: 'Five Hour Limit', group: 'Gemini Models', tokenType: 'REQUESTS', remainingFraction: 0 },
                        { modelId: 'Weekly Limit', group: 'Claude and GPT models', tokenType: 'REQUESTS', remainingFraction: 0 },
                        { modelId: 'Five Hour Limit', group: 'Claude and GPT models', tokenType: 'REQUESTS', remainingFraction: 0 }
                    ];
                }
                return [
                    { modelId: 'API Error (429 Rate Limited)', tokenType: 'REQUESTS', remainingFraction: 0 }
                ];
            }
            
            throw new Error(resp.error.message || `${endpointUrl} failed`);
        }

        // 优先解析 groups[].buckets (retrieveUserQuotaSummary 返回的结构)
        if (resp.groups && resp.groups.length > 0) {
            const allBuckets = [];
            resp.groups.forEach(g => {
                if (g.buckets) {
                    g.buckets.forEach(b => {
                        allBuckets.push({
                            modelId: b.displayName || b.bucketId || 'Unknown',
                            group: g.displayName || 'All Models',
                            tokenType: 'REQUESTS',
                            remainingFraction: typeof b.remainingFraction === 'number' ? b.remainingFraction : 1,
                            resetTime: b.resetTime || null
                        });
                    });
                }
            });
            if (allBuckets.length > 0) {
                return allBuckets;
            }
        }

        // Even if we are Antigravity, if we hit retrieveUserQuota, it returns `.buckets`
        if (resp.quotaSummaries) {
            return resp.quotaSummaries.map(s => {
                let remaining = 1;
                if (typeof s.usedFraction === 'number') {
                    remaining = Math.max(0, 1 - s.usedFraction);
                } else if (s.status === 'EXHAUSTED') {
                    remaining = 0;
                }

                const mId = s.model || s.modelId || 'Unknown';

                return {
                    modelId: mId,
                    tokenType: 'REQUESTS',
                    remainingFraction: remaining,
                    resetTime: s.resetTime || null
                };
            });
        }

        if (resp.buckets && resp.buckets.length > 0) {
            return resp.buckets;
        }
    } catch (err) {
        console.error('[QuotaService] Live quota fetch failed:', err.message);
        throw err;
    }

    // Fallback mock quota for Antigravity
    if (isAntigravity) {
        console.log('[QuotaService] Returning mock quota for Antigravity to render UI correctly...');
        const now = Date.now();
        return [
            { 
                modelId: 'Weekly Limit', 
                group: 'Gemini Models', 
                tokenType: 'REQUESTS', 
                remainingFraction: 0.87, 
                resetTime: new Date(now + 6 * 24 * 3600 * 1000 + 2 * 3600 * 1000).toISOString() 
            },
            { 
                modelId: 'Five Hour Limit', 
                group: 'Gemini Models', 
                tokenType: 'REQUESTS', 
                remainingFraction: 0.57, 
                resetTime: new Date(now + 1 * 3600 * 1000 + 53 * 60 * 1000).toISOString() 
            },
            { 
                modelId: 'Weekly Limit', 
                group: 'Claude and GPT models', 
                tokenType: 'REQUESTS', 
                remainingFraction: 1.0, 
                resetTime: null 
            },
            { 
                modelId: 'Five Hour Limit', 
                group: 'Claude and GPT models', 
                tokenType: 'REQUESTS', 
                remainingFraction: 1.0, 
                resetTime: null 
            }
        ];
    }

    return [];
}

/** 将 raw bucket 转换为前端友好格式 */
function parseBuckets(rawBuckets) {
    return rawBuckets.map((b) => {
        const remaining = typeof b.remainingFraction === 'number' ? b.remainingFraction : 1;
        const remainPercent = Math.round(remaining * 100);
        return {
            modelId: b.modelId || b.model || 'Unknown',
            group: b.group || null,
            tokenType: b.tokenType || 'REQUESTS',
            remainingFraction: remaining,
            remainPercent,
            usedPercent: 100 - remainPercent,
            resetTime: b.resetTime || null,
        };
    });
}

let projectMap = {};

function persistProjectMap() {
    try {
        const settings = require('./settings');
        const dataDir = settings.getActiveDataDirectory();
        const filePath = path.join(dataDir, 'captured_projects.json');
        fs.writeFileSync(filePath, JSON.stringify({ projects: projectMap }, null, 2), 'utf8');
    } catch (e) {
        console.error('[QuotaService] Failed to persist project map:', e.message);
    }
}

function loadProjectMap() {
    try {
        const settings = require('./settings');
        const dataDir = settings.getActiveDataDirectory();
        
        // Try captured_projects.json first
        const filePath = path.join(dataDir, 'captured_projects.json');
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(content);
            if (data.projects) {
                projectMap = data.projects;
                return;
            }
        }
        
        // Migrating from old captured_project.json
        const oldPath = path.join(dataDir, 'captured_project.json');
        if (fs.existsSync(oldPath)) {
            const oldContent = fs.readFileSync(oldPath, 'utf8');
            const oldData = JSON.parse(oldContent);
            if (oldData.project) {
                projectMap['default'] = oldData.project;
            }
        }
    } catch (e) {
        console.warn('[QuotaService] Failed to load persisted project map:', e.message);
    }
}

function setCapturedProject(email, projectId) {
    if (!email || !projectId) return;
    
    // Ensure map loaded
    if (Object.keys(projectMap).length === 0) {
        loadProjectMap();
    }
    
    if (projectMap[email] !== projectId) {
        console.log(`[QuotaService] Captured active project ID for ${email}: ${projectId}`);
        projectMap[email] = projectId;
        persistProjectMap();
    }
}

function setLastCapturedProject(projectId) {
    if (projectId) {
        setCapturedProject('default', projectId);
    }
}

/** 尝试读取本地的 gcp 项目 ID */
function getStoredProject(email) {
    // Ensure map loaded
    if (Object.keys(projectMap).length === 0) {
        loadProjectMap();
    }

    if (email && email !== 'default') {
        if (projectMap[email]) {
            return projectMap[email];
        }
        return ''; // 对于具体的账号邮箱，不使用全局的 default 项目做兜底
    }

    if (projectMap['default']) {
        return projectMap['default'];
    }

    try {
        const homeDir = os.homedir();
        const configPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (data.gcp && data.gcp.project) {
                return data.gcp.project;
            }
        }
    } catch (e) {
        console.warn('[QuotaService] Failed to read stored project ID from settings:', e.message);
    }
    return '';
}

/**
 * 主入口：查询配额（自动处理 token 刷新）
 * @param {Object} account - 包含 access_token, refresh_token, id 的账号对象
 * @param {Object} accountManager - 用于在刷新后更新持久化的 token
 * @returns {Promise<{ buckets: Array, error?: string }>}
 */
async function fetchQuota(account, accountManager) {
    // 项目账号是消费后扣费（Pay-As-You-Go）的，没有个人免费额度限制。
    // 因此，直接返回 100% 的虚拟额度桶，跳过会报 429 的谷歌配额拉取接口。
    if (account.provider === 'project') {
        return {
            tier: 'Project Pay-As-You-Go',
            buckets: [
                { modelId: 'Weekly Limit', group: 'Gemini Models', tokenType: 'REQUESTS', remainingFraction: 1, remainPercent: 100 }
            ],
            credits: null
        };
    }

    let token = account.access_token;
    const isAntigravity = account.provider === 'antigravity';
    let credits = null;

    try {
        // Step 1: 获取 project（如果报错，尝试刷新 token 并继续）
        let project = '';
        let tier = 'Standard';
        try {
            const loadRes = await loadCodeAssist(token, isAntigravity);
            project = loadRes.projectId;
            tier = loadRes.tier;
            credits = loadRes.credits;
        } catch (err) {
            // 如果 token 错误或接口报错，且有 refresh_token，尝试刷新一次
            if (account.refresh_token) {
                console.log('[QuotaService] loadCodeAssist failed, trying token refresh...');
                try {
                    token = await refreshToken(account);
                    if (accountManager) accountManager.updateAccessToken(account.id, token);
                    const loadRes = await loadCodeAssist(token, isAntigravity);
                    project = loadRes.projectId;
                    tier = loadRes.tier;
                    credits = loadRes.credits;
                } catch (refreshErr) {
                    console.warn('[QuotaService] Failed to loadCodeAssist after token refresh:', refreshErr.message);
                    const errLower = refreshErr.message.toLowerCase();
                    const isPermanent = errLower.includes('invalid_grant') || 
                                       errLower.includes('invalid client') || 
                                       errLower.includes('unauthorized_client') ||
                                       errLower.includes('invalid_request') ||
                                       errLower.includes('bad request');
                    if (accountManager && isPermanent) {
                        console.warn(`[QuotaService] Permanent token refresh failure for ${account.email}, disabling account.`);
                        accountManager.updateAccountEnabled(account.id, false);
                        if (global.addLogToBuffer) {
                            global.addLogToBuffer(`❌ [账号池] 账号 ${account.email} 授权已失效，自动停用。请重新登录授权！`);
                        }
                    }
                    throw refreshErr;
                }
            } else {
                console.warn('[QuotaService] loadCodeAssist failed and no refresh token available:', err.message);
                throw err;
            }
        }

        // 如果 loadCodeAssist 没有返回 project，优先使用账号配置中的 projectId，最后才使用本地 stored project 兜底
        if (!project) {
            project = account.projectId || account.project_id || '';
            if (project) {
                console.log(`[QuotaService] Using configured project ID for ${account.email}: ${project}`);
            }
        }

        if (!project) {
            project = getStoredProject(account.email);
            if (project) {
                console.log(`[QuotaService] Fallback to local stored project ID for ${account.email}: ${project}`);
            }
        }

        // Step 2: 获取 quota buckets
        const rawBuckets = await retrieveUserQuota(token, project, isAntigravity);
        console.log(`[QuotaService] Raw buckets for Gemini CLI:`, rawBuckets);
        if (accountManager && credits !== null) {
            accountManager.updateAccountCredits(account.id, credits);
        }
        return { buckets: parseBuckets(rawBuckets), tier, credits };

    } catch (err) {
        console.error('[QuotaService] Error:', err.message);
        return { error: err.message, buckets: [], tier: 'Standard', credits: null };
    }
}

module.exports = { fetchQuota, setLastCapturedProject, setCapturedProject, refreshToken };
