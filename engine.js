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
                const fs = require('fs');
                const path = require('path');
                try {
                    const captureStr = `[${new Date().toISOString()}] ${req.method} ${targetHost}${targetPath}\nHeaders: ${JSON.stringify(req.headers)}\nBody: ${reqBody.toString('utf8')}\n\n`;
                    fs.appendFileSync(path.join(process.cwd(), 'capture.log'), captureStr);
                } catch (e) {}
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

                // Logging details helper
                let inTokens = 0, outTokens = 0, cachedTokens = 0;
                let cacheStatus = 'NONE';
                let logged = false;

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
                        inTokens,
                        outTokens,
                        cachedTokens,
                        cacheStatus,
                        statusCode,
                        requestBody
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
                        const poolToken = accountManager.getNextToken();
                        let finalReqBody = reqBody;

                        if (poolToken) {
                            customHeaders['authorization'] = `Bearer ${poolToken}`;
                            if (attemptIndex === 1) {
                                const acc = accountManager.accounts[accountManager.currentIndex === 0 ? accountManager.accounts.length - 1 : accountManager.currentIndex - 1];
                                this.emit('log', `🔀 [Pool Mode] Request injected with pool token (Account: ${acc?.email} | ${acc?.provider})`);
                            }
                        }
                        
                        // Strip 'project' ID from payload to prevent 429 Quota Exhaustion on IDE's default project
                        if (reqBody.length > 0 && customHeaders['content-type'] && customHeaders['content-type'].includes('json')) {
                            try {
                                const bodyJson = JSON.parse(reqBody.toString('utf8'));
                                if (bodyJson.project) {
                                    delete bodyJson.project;
                                    const newBodyStr = JSON.stringify(bodyJson);
                                    finalReqBody = Buffer.from(newBodyStr, 'utf8');
                                    customHeaders['content-length'] = finalReqBody.length;
                                    if (attemptIndex === 1) {
                                        this.emit('log', `🛡️ Stripped 'project' ID from payload to avoid IDE default project quota 429.`);
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

                            let fullBodyStr = '';
                            snifferStream.on('data', (chunk) => {
                                fullBodyStr += chunk.toString('utf8');
                            });

                            snifferStream.on('end', () => {
                                if (proxyRes.statusCode === 200 && targetPath.includes('GenerateContent')) {
                                    try {
                                        const promptMatch = fullBodyStr.match(/"promptTokenCount":\s*(\d+)/g);
                                        const candidateMatch = fullBodyStr.match(/"candidatesTokenCount":\s*(\d+)/g);
                                        const cachedMatch = fullBodyStr.match(/"cachedContentTokenCount":\s*(\d+)/g);

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

                for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
                    try {
                        if (attempt > 0) this.emit('log', `${logPrefix} Attempt ${attempt + 1}/${this.MAX_RETRIES + 1} ...`);
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
                        if (error.message === 'CAPACITY_EXHAUSTED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                            if (attempt === this.MAX_RETRIES) {
                                this.emit('log', `${logPrefix} ❌ Error: Max retries reached.`);
                                logRequestToTracker(503);
                                res.writeHead(503, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: { code: 503, message: "Proxy exhausted max retries", status: "UNAVAILABLE" } }));
                                return;
                            }
                            const jitter = Math.random() * 500;
                            const delay = (this.BASE_DELAY_MS * Math.pow(2, attempt)) + jitter;
                            this.emit('log', `${logPrefix} ⚠️ Capacity exhausted (503). Retrying in ${Math.round(delay)}ms...`);
                            await this.sleep(delay);
                        } else {
                            this.emit('log', `${logPrefix} ❌ Unhandled Error: ${error.message}`);
                            logRequestToTracker(500);
                            res.writeHead(500);
                            res.end("Internal Proxy Error");
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
