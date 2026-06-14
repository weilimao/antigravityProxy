const https = require('https');
const zlib = require('zlib');
const EventEmitter = require('events');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { app } = require('electron');
const { Proxy } = require('http-mitm-proxy');
const { PassThrough } = require('stream');
const statsTracker = require('./src/core/stats');
const accountManager = require('./src/core/accountManager');

class ProxyEngine extends EventEmitter {
    constructor() {
        super();
        this.proxy = null;
        this.isRunning = false;
        this.isInterceptMode = false;
        this.LISTEN_PORT = 18443;
        this.TARGET_HOST = 'cloudcode-pa.googleapis.com';
        this.MAX_RETRIES = 5;
        this.BASE_DELAY_MS = 1000;
        this.activeTunnels = new Set();

        // Bind tracker to user data directory
        const settings = require('./src/core/settings');
        statsTracker.init(settings.getActiveDataDirectory());
        this.stats = statsTracker.stats; // Expose reference for backward compatibility
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    setMode(mode) {
        this.isInterceptMode = mode;
        this.emit('state', mode);

        if (this.activeTunnels && this.activeTunnels.size > 0) {
            this.emit('log', `🔄 Mode changed. Closing ${this.activeTunnels.size} active passthrough tunnels to force client reconnection...`);
            for (const tunnel of this.activeTunnels) {
                try { tunnel.socket.destroy(); } catch (e) {}
                try { tunnel.serverSocket.destroy(); } catch (e) {}
            }
            this.activeTunnels.clear();
        }
    }

    updateStats(modelName, inTokens, outTokens, cachedTokens) {
        statsTracker.trackRequest(modelName, inTokens, outTokens, cachedTokens);
        this.emit('stats', statsTracker.getPayload());
    }

    start() {
        if (this.isRunning || this.proxy) return;

        this.proxy = new Proxy();

        // Handle CONNECT for dynamic passthrough/decrypt switching
        this.proxy.onConnect((req, socket, head, callback) => {
            const parts = req.url.split(':');
            const host = parts[0];
            const port = parseInt(parts[1]) || 443;
            const tunnelLabel = `[CONNECT ${host}:${port}]`;

            const userAgent = (req.headers['user-agent'] || '').toLowerCase();
            const isGoClient = userAgent.includes('go-http-client') || userAgent.includes('antigravity') || userAgent.includes('cloudcode');
            const isTargetHost = host.includes('generativelanguage.googleapis.com') || host.includes('cloudcode-pa.googleapis.com');

            const shouldDecrypt = this.isInterceptMode && isTargetHost && isGoClient;

            this.emit('log', `🔍 Host: ${host} | Decrypt: ${shouldDecrypt} | UA: ${userAgent || 'none'}`);

            if (!shouldDecrypt) {
                this.emit('log', `🔀 ${tunnelLabel} Tunnel establishing (Passthrough)...`);

                const serverSocket = net.connect(port, host, () => {
                    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    if (head && head.length > 0) {
                        serverSocket.write(head);
                    }
                    serverSocket.pipe(socket, { end: false });
                    socket.pipe(serverSocket, { end: false });
                    this.emit('log', `✅ ${tunnelLabel} Tunnel established (Passthrough)`);
                });

                const tunnelInfo = { socket, serverSocket };
                this.activeTunnels.add(tunnelInfo);

                const cleanup = () => {
                    this.activeTunnels.delete(tunnelInfo);
                };

                serverSocket.on('error', (err) => {
                    this.emit('log', `❌ ${tunnelLabel} Tunnel error: ${err.message}`);
                    socket.destroy();
                });

                socket.on('error', () => {
                    serverSocket.destroy();
                });

                serverSocket.on('end', () => socket.destroy());
                socket.on('end', () => serverSocket.destroy());

                serverSocket.on('close', cleanup);
                socket.on('close', cleanup);

                return;
            }

            this.emit('log', `🕵️ ${tunnelLabel} Decrypting HTTPS traffic...`);
            return callback();
        });

        // Handle Decrypted HTTP/HTTPS Requests
        this.proxy.onRequest((ctx, callback) => {
            const req = ctx.clientToProxyRequest;
            const res = ctx.proxyToClientResponse;

            if (req.headers.expect && req.headers.expect.toLowerCase() === '100-continue') {
                res.writeContinue();
            }

            req.resume(); // Resume client request stream

            const reqChunks = [];
            req.on('data', (chunk) => {
                reqChunks.push(chunk);
            });

            req.on('end', async () => {
                const reqBody = Buffer.concat(reqChunks);

                // Capture active project from request body
                if (reqBody && reqBody.length > 0) {
                    try {
                        const bodyJson = JSON.parse(reqBody.toString('utf8'));
                        if (bodyJson.project) {
                            const quotaService = require('./src/core/quotaService');
                            let email = 'default';
                            const authHeader = req.headers['authorization'] || '';
                            if (authHeader.startsWith('Bearer ')) {
                                const token = authHeader.substring(7);
                                const accountManager = require('./src/core/accountManager');
                                const account = accountManager.accounts.find(a => a.access_token === token);
                                if (account && account.email) {
                                    email = account.email;
                                }
                            }
                            quotaService.setCapturedProject(email, bodyJson.project);
                        }
                    } catch (e) {}
                }

                let targetHost = this.TARGET_HOST;
                let targetPath = req.url;

                if (req.url.startsWith('http://') || req.url.startsWith('https://')) {
                    try {
                        const parsedUrl = new URL(req.url);
                        targetHost = parsedUrl.hostname;
                        targetPath = parsedUrl.pathname + parsedUrl.search;
                    } catch (e) {}
                } else if (req.headers.host) {
                    targetHost = req.headers.host.split(':')[0];
                }

                // --- CAPTURE ALL TRAFFIC FOR DEBUGGING ---
                if (process.env.DEBUG_PROXY === 'true') {
                    try {
                        const captureStr = `[${new Date().toISOString()}] ${req.method} ${targetHost}${targetPath}\nHeaders: ${JSON.stringify(req.headers)}\nBody: ${reqBody.toString('utf8')}\n\n`;
                        fs.appendFileSync(path.join(process.cwd(), 'capture.log'), captureStr);
                    } catch (e) {}
                }
                // -----------------------------------------

                // Fallback direct hosts mapping
                if (targetHost === '127.0.0.1' || targetHost === 'localhost') {
                    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
                    const isAntigravityAgent = userAgent.includes('antigravity');

                    if (req.url.includes('generativelanguage') || req.url.includes('models')) {
                        targetHost = 'generativelanguage.googleapis.com';
                    } else if (req.url.includes('daily-cloudcode-pa') || isAntigravityAgent) {
                        targetHost = 'daily-cloudcode-pa.googleapis.com';
                    } else {
                        targetHost = 'cloudcode-pa.googleapis.com';
                    }
                }

                const logPrefix = `[${req.method} -> ${targetHost}${targetPath}]`;

                let currentModel = 'unknown';
                const modelMatch = targetPath.match(/\/models\/([^:]+)/);
                if (modelMatch) {
                    currentModel = modelMatch[1];
                } else if (targetPath.includes('streamGenerateContent')) {
                    currentModel = 'antigravity-core'; // 默认回退值
                    if (reqBody && reqBody.length > 0) {
                        try {
                            const bodyJson = JSON.parse(reqBody.toString('utf8'));
                            if (bodyJson.model) {
                                // 提取类似 "models/gemini-1.5-flash" 或 "gemini-1.5-flash" 中的模型代号
                                const m = bodyJson.model.match(/(?:models\/)?(.+)/);
                                if (m) currentModel = m[1];
                            }
                        } catch (e) {
                            // 鲁棒性：若 JSON 解析失败，尝试使用正则提取
                            const bodyStr = reqBody.toString('utf8');
                            const m = bodyStr.match(/"model"\s*:\s*"([^"]+)"/);
                            if (m) {
                                const internalModel = m[1];
                                const m2 = internalModel.match(/(?:models\/)?(.+)/);
                                if (m2) currentModel = m2[1];
                            }
                        }
                    }
                }

                // 提取粘性会话 Key（在 attemptRequest 外提取一次，确保整个请求过程包含重试使用相同会话 Key）
                const sessionKey = require('./src/core/sessionRouter').extractSessionKey(req, reqBody);

                // Logging details helper
                let inTokens = 0, outTokens = 0, cachedTokens = 0;
                let cacheStatus = 'NONE';
                let logged = false;
                let allocatedAccount = null;

                const logRequestToTracker = (statusCode) => {
                    if (logged) return;
                    logged = true;
                    
                    if (statusCode === 200 && targetPath.includes('GenerateContent')) {
                        cacheStatus = cachedTokens > 0 ? 'HIT' : 'MISS';
                    } else if (targetPath.includes('GenerateContent')) {
                        cacheStatus = 'MISS';
                    }

                    let requestBody = null;
                    if (reqBody && reqBody.length > 0) {
                        try {
                            requestBody = JSON.parse(reqBody.toString('utf8'));
                        } catch (e) {
                            requestBody = reqBody.toString('utf8');
                        }
                    }

                    statsTracker.addRequestLog({
                        method: req.method,
                        host: targetHost,
                        path: targetPath,
                        model: currentModel,
                        account: allocatedAccount,
                        inTokens,
                        outTokens,
                        cachedTokens,
                        cacheStatus,
                        statusCode,
                        requestBody,
                        sessionId: sessionKey
                    });

                    // Emit to update main window stats
                    this.emit('stats', statsTracker.getPayload());
                };

                if (reqBody.length > 0) {
                    const safeString = reqBody.toString('utf8').replace(/[^\x20-\x7E一-龥]/g, '');
                    const preview = safeString.length > 150 ? safeString.substring(0, 150) + '...' : safeString;
                    this.emit('log', `${logPrefix} Headers: ${JSON.stringify(req.headers)} | Payload: ${preview}`);
                } else {
                    this.emit('log', `${logPrefix} Headers: ${JSON.stringify(req.headers)}`);
                }

                const attemptRequest = (attemptIndex) => {
                    return new Promise((resolve, reject) => {
                        // --- 账号池 token 注入 ---
                        const accountManager = require('./src/core/accountManager');
                        const customHeaders = { ...req.headers, host: targetHost };
                        let poolAccount = null;
                        if (accountManager.getPoolMode()) {
                            poolAccount = accountManager.getAccountBySticky(
                                sessionKey,
                                currentModel,
                                (msg) => this.emit('log', msg)
                            );
                            if (!poolAccount) {
                                return reject(new Error('QUOTA_EXHAUSTED'));
                            }
                        } else {
                            if (attemptIndex === 0) {
                                this.emit('log', `⚖️ [负载均衡] 负载均衡开关已关闭，不走负载均衡逻辑，直接使用客户端凭证`);
                            }
                        }
                        let finalReqBody = reqBody;

                        if (poolAccount) {
                            customHeaders['authorization'] = `Bearer ${poolAccount.access_token}`;
                            allocatedAccount = poolAccount.email;
                            lastUsedAccountObj = poolAccount; // 外部闭包捕获，以便重试出错时能够精确定位冷静账号
                            if (attemptIndex === 0) {
                                this.emit('log', `⚖️ [负载均衡] 请求已分配账号: ${poolAccount.email} (${poolAccount.provider}) | 目标模型: ${currentModel}`);
                            } else {
                                this.emit('log', `⚖️ [负载均衡] 请求重试，重新分配账号: ${poolAccount.email} (${poolAccount.provider}) | 目标模型: ${currentModel}`);
                            }
                        }
                        
                        // Strip 'project' ID or inject configured project ID based on account channel
                        if (reqBody.length > 0 && customHeaders['content-type'] && customHeaders['content-type'].includes('json')) {
                            try {
                                const bodyJson = JSON.parse(reqBody.toString('utf8'));
                                if (bodyJson && typeof bodyJson === 'object' && !Array.isArray(bodyJson)) {
                                    // Determine the target project to inject
                                    let targetProject = null;
                                    if (poolAccount) {
                                        if (poolAccount.provider !== 'antigravity') {
                                            // For Project API accounts, inject their configured project ID
                                            targetProject = poolAccount.projectId || poolAccount.project_id || null;
                                        } else {
                                            // For 'antigravity' provider, we only want to strip the default placeholder project (expanded-palisade-stpfc)
                                            // to avoid IDE default project quota 429. If it's a custom user project, we keep it.
                                            const isDefaultProj = (proj) => {
                                                if (typeof proj !== 'string') return false;
                                                return proj === 'expanded-palisade-stpfc' || proj.startsWith('expanded-palisade-');
                                            };
                                            if (bodyJson.project && !isDefaultProj(bodyJson.project)) {
                                                targetProject = bodyJson.project;
                                            }
                                        }
                                    } else {
                                        // If no pool account is used, keep the original project if present
                                        targetProject = bodyJson.project || null;
                                    }

                                    if (targetProject) {
                                        // Inject/Overwrite the project ID only if the original request originally had a project field
                                        if (bodyJson.project !== undefined && bodyJson.project !== targetProject) {
                                            bodyJson.project = targetProject;
                                            const newBodyStr = JSON.stringify(bodyJson);
                                            finalReqBody = Buffer.from(newBodyStr, 'utf8');
                                            customHeaders['content-length'] = finalReqBody.length;
                                            if (attemptIndex === 0) {
                                                this.emit('log', `🛡️ Injected configured project ID '${targetProject}' into payload.`);
                                            }
                                        }
                                    } else {
                                        // Strip the project ID if we don't have one (e.g. Antigravity accounts)
                                        if (bodyJson.project) {
                                            delete bodyJson.project;
                                            const newBodyStr = JSON.stringify(bodyJson);
                                            finalReqBody = Buffer.from(newBodyStr, 'utf8');
                                            customHeaders['content-length'] = finalReqBody.length;
                                            if (attemptIndex === 0) {
                                                this.emit('log', `🛡️ Stripped 'project' ID from payload to avoid IDE default project quota 429.`);
                                            }
                                        }
                                    }
                                }
                            } catch (e) {}
                        }
                        // -------------------------

                        const options = {
                            hostname: targetHost,
                            port: 443,
                            path: targetPath,
                            method: req.method,
                            headers: customHeaders,
                            rejectUnauthorized: false
                        };

                        const proxyReq = https.request(options, (proxyRes) => {
                            // 429 Quota/Rate Limit Exhausted
                            if (proxyRes.statusCode === 429 && !targetPath.includes('retrieveUserQuota')) {
                                const resChunks = [];
                                proxyRes.on('data', chunk => resChunks.push(chunk));
                                proxyRes.on('end', () => {
                                    const resBody = Buffer.concat(resChunks);
                                    let bodyStr = '';
                                    try {
                                        if (proxyRes.headers['content-encoding'] === 'gzip') {
                                            bodyStr = zlib.gunzipSync(resBody).toString('utf8');
                                        } else if (proxyRes.headers['content-encoding'] === 'deflate') {
                                            bodyStr = zlib.inflateSync(resBody).toString('utf8');
                                        } else {
                                            bodyStr = resBody.toString('utf8');
                                        }
                                    } catch (e) {
                                        bodyStr = resBody.toString('utf8');
                                    }

                                    const isQuotaError = bodyStr.includes('RESOURCE_EXHAUSTED') || 
                                                         bodyStr.includes('quota') || 
                                                         bodyStr.includes('exhausted') || 
                                                         bodyStr.includes('limit') ||
                                                         bodyStr.includes('MODEL_CAPACITY_EXHAUSTED');

                                    if (isQuotaError) {
                                        reject(new Error('QUOTA_EXHAUSTED'));
                                    } else {
                                        resolve({ isRetryable: false, proxyRes, bodyBuffer: resBody });
                                    }
                                });
                                return;
                            }

                            // 503 Capacity Exhausted
                            if (proxyRes.statusCode === 503) {
                                const resChunks = [];
                                proxyRes.on('data', chunk => resChunks.push(chunk));
                                proxyRes.on('end', () => {
                                    const resBody = Buffer.concat(resChunks);
                                    let bodyStr = '';
                                    try {
                                        if (proxyRes.headers['content-encoding'] === 'gzip') {
                                            bodyStr = zlib.gunzipSync(resBody).toString('utf8');
                                        } else if (proxyRes.headers['content-encoding'] === 'deflate') {
                                            bodyStr = zlib.inflateSync(resBody).toString('utf8');
                                        } else {
                                            bodyStr = resBody.toString('utf8');
                                        }
                                    } catch (e) {
                                        bodyStr = resBody.toString('utf8');
                                    }

                                    if (bodyStr.includes('MODEL_CAPACITY_EXHAUSTED')) {
                                        reject(new Error('CAPACITY_EXHAUSTED'));
                                    } else {
                                        resolve({ isRetryable: false, proxyRes, bodyBuffer: resBody });
                                    }
                                });
                                return;
                            }

                            // Intercept 429 for Quota API to prevent IDE infinite loop
                            if (proxyRes.statusCode === 429 && targetPath.includes('retrieveUserQuota')) {
                                this.emit('log', `⚠️ Intercepted 429 from Google Quota API. Mocking 200 OK to prevent IDE infinite loop.`);
                                const mockQuotaResponse = {
                                    quotaSummaries: [
                                        { model: 'Gemini Weekly Quota', usedFraction: 1.0 },
                                        { model: 'Gemini 5-Hour Quota', usedFraction: 1.0 },
                                        { model: 'Claude Weekly Quota', usedFraction: 1.0 },
                                        { model: 'Claude 5-Hour Quota', usedFraction: 1.0 }
                                    ],
                                    groups: [
                                        {
                                            displayName: 'Gemini Models',
                                            buckets: [
                                                { displayName: 'Weekly Limit', remainingFraction: 0.0 },
                                                { displayName: 'Five Hour Limit', remainingFraction: 0.0 }
                                            ]
                                        },
                                        {
                                            displayName: 'Claude and GPT models',
                                            buckets: [
                                                { displayName: 'Weekly Limit', remainingFraction: 0.0 },
                                                { displayName: 'Five Hour Limit', remainingFraction: 0.0 }
                                            ]
                                        }
                                    ]
                                };
                                const mockBuffer = Buffer.from(JSON.stringify(mockQuotaResponse), 'utf8');
                                
                                proxyRes.on('data', () => {}); // Drain stream
                                proxyRes.on('end', () => {
                                    logRequestToTracker(429);
                                });
                                
                                resolve({ 
                                    isRetryable: false, 
                                    proxyRes: { 
                                        statusCode: 200, 
                                        headers: { 'content-type': 'application/json', 'content-length': mockBuffer.length } 
                                    }, 
                                    bodyBuffer: mockBuffer 
                                });
                                return;
                            }

                            // Structured logging for non-GenerateContent responses when they end
                            if (proxyRes.statusCode !== 200 || !targetPath.includes('GenerateContent')) {
                                proxyRes.on('end', () => {
                                    logRequestToTracker(proxyRes.statusCode);
                                });
                            }

                            // Sniff response body to extract stats
                            const clientStream = new PassThrough();
                            clientStream.statusCode = proxyRes.statusCode;
                            clientStream.headers = proxyRes.headers;
                            proxyRes.pipe(clientStream);

                            let snifferStream = proxyRes;
                            if (proxyRes.headers['content-encoding'] === 'gzip') {
                                snifferStream = proxyRes.pipe(zlib.createGunzip());
                            } else if (proxyRes.headers['content-encoding'] === 'deflate') {
                                snifferStream = proxyRes.pipe(zlib.createInflate());
                            }

                            const maxWindowSize = 8192; // 8KB 足够容纳 usageMetadata
                            let tailBuffer = '';
                            snifferStream.on('data', (chunk) => {
                                tailBuffer += chunk.toString('utf8');
                                if (tailBuffer.length > maxWindowSize) {
                                    tailBuffer = tailBuffer.substring(tailBuffer.length - maxWindowSize);
                                }
                            });

                            snifferStream.on('end', () => {
                                if (proxyRes.statusCode === 200 && targetPath.includes('GenerateContent')) {
                                    try {
                                        const promptMatch = tailBuffer.match(/"promptTokenCount":\s*(\d+)/g);
                                        const candidateMatch = tailBuffer.match(/"candidatesTokenCount":\s*(\d+)/g);
                                        const cachedMatch = tailBuffer.match(/"cachedContentTokenCount":\s*(\d+)/g);

                                        if (promptMatch) {
                                            const lastMatch = promptMatch[promptMatch.length - 1];
                                            inTokens = parseInt(lastMatch.match(/\d+/)[0]);
                                        }
                                        if (candidateMatch) {
                                            const lastMatch = candidateMatch[candidateMatch.length - 1];
                                            outTokens = parseInt(lastMatch.match(/\d+/)[0]);
                                        }
                                        if (cachedMatch) {
                                            const lastMatch = cachedMatch[cachedMatch.length - 1];
                                            cachedTokens = parseInt(lastMatch.match(/\d+/)[0]);
                                        }

                                        if (inTokens > 0 || outTokens > 0) {
                                            this.updateStats(currentModel, inTokens, outTokens, cachedTokens);
                                            this.emit('log', `📊 [${currentModel}] Usage: ${inTokens} In | ${outTokens} Out | ${cachedTokens} Cached (Hit rate: ${((cachedTokens/inTokens)*100).toFixed(1)}%)`);
                                        }
                                    } catch (err) {}
                                }
                                logRequestToTracker(proxyRes.statusCode);
                            });

                            resolve({ isRetryable: false, proxyRes: clientStream });
                        });

                        proxyReq.on('error', (e) => reject(e));

                        if (finalReqBody.length > 0) {
                            proxyReq.write(finalReqBody);
                        }
                        proxyReq.end();
                    });
                };

                let lastUsedAccountObj = null;
                const maxRetries = 20;

                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        if (attempt > 0) this.emit('log', `${logPrefix} ⚖️ 正在进行负载均衡第 ${attempt + 1}/${maxRetries + 1} 次尝试...`);
                        const result = await attemptRequest(attempt);

                        if (attempt > 0) this.emit('log', `${logPrefix} Response Status: ${result.proxyRes.statusCode}`);

                        res.writeHead(result.proxyRes.statusCode || 200, result.proxyRes.headers);
                        if (result.bodyBuffer) {
                            res.end(result.bodyBuffer);
                        } else {
                            result.proxyRes.pipe(res);
                        }
                        return;

                    } catch (error) {
                        const isRetryableError = error.message === 'CAPACITY_EXHAUSTED' || 
                                                 error.message === 'QUOTA_EXHAUSTED' || 
                                                 error.code === 'ECONNRESET' || 
                                                 error.code === 'ETIMEDOUT';

                        // 额度空置触发冷静期隔离
                        if (lastUsedAccountObj && (error.message === 'CAPACITY_EXHAUSTED' || error.message === 'QUOTA_EXHAUSTED')) {
                            const accId = lastUsedAccountObj.id;
                            const email = lastUsedAccountObj.email;
                            const currentAccountObj = lastUsedAccountObj; // 闭包防污染
                            
                            this.emit('log', `⚠️ [负载均衡] 检测到账号 ${email} 额度已耗尽 (Error: ${error.message})。正在获取其配额恢复时间并标记冷静期...`);
                            
                            // 1. 立即标记冷静状态，防止在当下立即发起的下一次 attempt 中被重复选中
                            accountManager.setAccountCooldown(accId, Date.now() + 5 * 60 * 1000, currentModel); // 默认冷静 5 分钟
                            
                            // 2. 异步向谷歌查询配额重置时间以修正冷静期
                            (async () => {
                                try {
                                    const quotaService = require('./src/core/quotaService');
                                    const res = await quotaService.fetchQuota(currentAccountObj, accountManager);
                                    let cooldownTime = null;
                                    
                                    if (res && res.buckets) {
                                        // 优先考虑周配额
                                        const weeklyBuckets = res.buckets.filter(b => b.modelId && b.modelId.includes('Weekly'));
                                        const exhaustedWeekly = weeklyBuckets.find(b => b.remainingFraction === 0 && b.resetTime);
                                        if (exhaustedWeekly) {
                                            cooldownTime = new Date(exhaustedWeekly.resetTime).getTime();
                                            this.emit('log', `⏳ [负载均衡] 账号 ${email} 周额度空置，冷静期截止至 ${new Date(cooldownTime).toLocaleString()}`);
                                        } else {
                                            // 其次考虑五小时配额
                                            const fiveHourBuckets = res.buckets.filter(b => b.modelId && b.modelId.includes('Five Hour'));
                                            const exhaustedFiveHour = fiveHourBuckets.find(b => b.remainingFraction === 0 && b.resetTime);
                                            if (exhaustedFiveHour) {
                                                cooldownTime = new Date(exhaustedFiveHour.resetTime).getTime();
                                                this.emit('log', `⏳ [负载均衡] 账号 ${email} 5小时额度空置，冷静期截止至 ${new Date(cooldownTime).toLocaleString()}`);
                                            }
                                        }
                                    }
                                    
                                    if (cooldownTime) {
                                        accountManager.setAccountCooldown(accId, cooldownTime, currentModel);
                                    } else {
                                        this.emit('log', `⏳ [负载均衡] 无法解析到账号 ${email} 具体的重置时间，默认冷静期延长至 10 分钟。`);
                                        accountManager.setAccountCooldown(accId, Date.now() + 10 * 60 * 1000, currentModel);
                                    }
                                } catch (e) {
                                    console.error('[Engine] Cooldown fetch failed:', e.message);
                                }
                            })();
                        }

                        // 判断对于 QUOTA_EXHAUSTED 是否需要继续重试
                        let shouldRetry = isRetryableError && attempt < maxRetries;
                        if (error.message === 'QUOTA_EXHAUSTED') {
                            const hasAvailableAccounts = accountManager.getPoolMode() && accountManager.accounts.some(a => {
                                if (a.enabled === false) return false;
                                const category = accountManager.getModelCategory(currentModel);
                                const cooldown = a.cooldowns ? a.cooldowns[category] : a.cooldownUntil;
                                return !cooldown || Date.now() >= cooldown;
                            });
                            if (!hasAvailableAccounts) {
                                shouldRetry = false;
                            }
                        }

                        if (shouldRetry) {
                            const jitter = Math.random() * 500;
                            const baseDelay = this.BASE_DELAY_MS * Math.pow(2, attempt);
                            const delay = Math.min(baseDelay, 10000) + jitter; // 限制单次等待延迟最大在 10s + 抖动 左右
                            this.emit('log', `${logPrefix} ⚠️ 请求失败 (${error.message || error.code})。负载均衡将在 ${Math.round(delay)}ms 后自动切换账号重试...`);
                            await this.sleep(delay);
                        } else {
                            this.emit('log', `${logPrefix} ❌ [负载均衡] 尝试失败: ${error.message || error.code || '所有可用账号额度均已耗尽'}`);
                            logRequestToTracker(error.message === 'QUOTA_EXHAUSTED' ? 429 : 503);
                            res.writeHead(error.message === 'QUOTA_EXHAUSTED' ? 429 : 503, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ 
                                error: { 
                                    code: error.message === 'QUOTA_EXHAUSTED' ? 429 : 503, 
                                    message: error.message === 'QUOTA_EXHAUSTED' ? "Active accounts quota exhausted" : "Proxy connection failed", 
                                    status: "RESOURCE_EXHAUSTED" 
                                } 
                            }));
                            return;
                        }
                    }
                }
            });
        });

        this.proxy.onError((ctx, err, errorKind) => {
            this.emit('log', `⚠️ Proxy Connection Error (${errorKind}): ${err.message}`);
        });

        const settings = require('./src/core/settings');
        const caDir = path.join(settings.getActiveDataDirectory(), 'certs');
        this.proxy.listen({
            host: '127.0.0.1',
            port: this.LISTEN_PORT,
            sslCaDir: caDir
        }, (err) => {
            if (err) {
                this.emit('log', `❌ Proxy listen failed: ${err.message}`);
                return;
            }
            this.isRunning = true;
            this.emit('log', `🚀 Decrypting Proxy Server running on port ${this.LISTEN_PORT}`);
            
            this.emit('state', this.isInterceptMode);
        });
    }

    stop() {
        if (this.proxy) {
            this.proxy.close();
            this.isRunning = false;
            this.proxy = null;
            this.emit('log', `🛑 Proxy Server stopped.`);
            this.emit('state', false);
            statsTracker.saveToDisk();
        }
    }
}

module.exports = ProxyEngine;
