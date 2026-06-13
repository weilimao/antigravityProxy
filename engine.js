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

        this.stats = {
            totalRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCachedTokens: 0,
            models: {}
        };

        this.reqLogArray = [];
        this.resLogArray = [];
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    saveLog(type, logStr) {
        const arr = type === 'req' ? this.reqLogArray : this.resLogArray;
        const file = type === 'req' ? 'requests.log' : 'responses.log';
        arr.push(logStr);
        if (arr.length > 50) arr.shift();
        
        const content = arr.join('\n\n==================================================\n\n');
        fs.writeFile(path.join(app.getPath('userData'), file), content, 'utf8', () => {});
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

    updateStats(modelName, inputTokens, outputTokens, cachedTokens) {
        this.stats.totalRequests++;
        this.stats.totalInputTokens += inputTokens;
        this.stats.totalOutputTokens += outputTokens;
        this.stats.totalCachedTokens += cachedTokens;

        if (!this.stats.models[modelName]) {
            this.stats.models[modelName] = { reqs: 0, inTokens: 0, outTokens: 0, cachedTokens: 0 };
        }
        this.stats.models[modelName].reqs++;
        this.stats.models[modelName].inTokens += inputTokens;
        this.stats.models[modelName].outTokens += outputTokens;
        this.stats.models[modelName].cachedTokens += cachedTokens;

        this.emit('stats', this.stats);
    }

    installRootCertificate() {
        if (process.platform === 'win32') {
            try {
                const caCertPath = path.join(app.getPath('userData'), 'certs', 'certs', 'ca.pem');
                if (fs.existsSync(caCertPath)) {
                    execSync(`certutil -user -addstore -f ROOT "${caCertPath}"`, { stdio: 'ignore' });
                    this.emit('log', '🔒 Local Root CA successfully trusted in Windows User store.');
                }
            } catch (e) {
                this.emit('log', `❌ Failed to trust local Root CA: ${e.message}`);
            }
        }
    }

    uninstallRootCertificate() {
        if (process.platform === 'win32') {
            try {
                execSync('certutil -user -delstore ROOT NodeMITMProxyCA', { stdio: 'ignore' });
                this.emit('log', '🔓 Local Root CA removed from Windows User store.');
            } catch (e) {
                // Ignore errors on exit
            }
        }
    }

    start() {
        if (this.isRunning || this.proxy) return;

        this.proxy = new Proxy();

        // 核心：处理 CONNECT 连接以支持动态直通 / 解密切换
        this.proxy.onConnect((req, socket, head, callback) => {
            const parts = req.url.split(':');
            const host = parts[0];
            const port = parseInt(parts[1]) || 443;
            const tunnelLabel = `[CONNECT ${host}:${port}]`;

            // 识别客户端身份：
            // Go 语言 backend 发起 CONNECT 时通常带 Go-http-client；
            // 而 Electron/Chromium 前端（IDE）发起 CONNECT 时可能没有 UA 或带有其他 UA。
            const userAgent = (req.headers['user-agent'] || '').toLowerCase();
            const isGoClient = userAgent.includes('go-http-client');

            // 核心安全优化：我们只拦截和解密特定的 developer API 域名。
            // 包括 generativelanguage.googleapis.com 和 cloudcode-pa.googleapis.com。
            // 关键：为了避免 BoringSSL 握手失败（SSL Alert 42）造成的 IDE 初始化死锁与白屏，
            // 我们仅对 Go Client 的流量进行解密拦截（因为 Go Client 已配置 SSL_CERT_FILE 信任证书）。
            const isTargetHost = host.includes('generativelanguage.googleapis.com') || host.includes('cloudcode-pa.googleapis.com');

            const shouldDecrypt = this.isInterceptMode && isTargetHost && isGoClient;

            this.emit('log', `🔍 Host: ${host} | Decrypt: ${shouldDecrypt} | UA: ${userAgent || 'none'}`);

            // 如果处于 Passthrough 直通模式，或者不需要解密，完全跳过解密，建立盲 TCP 转发隧道
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

                return; // 不调用 callback()，从而阻止 http-mitm-proxy 进行 TLS 握手解密
            }

            // 如果处于 Intercept 拦截模式且是目标客户端，调用 callback() 让 http-mitm-proxy 自动签发证书并解密
            this.emit('log', `🕵️ ${tunnelLabel} Decrypting HTTPS traffic...`);
            return callback();
        });

        // 处理解密后的 HTTP / HTTPS 请求
        this.proxy.onRequest((ctx, callback) => {
            const req = ctx.clientToProxyRequest;
            const res = ctx.proxyToClientResponse;

            if (req.headers.expect && req.headers.expect.toLowerCase() === '100-continue') {
                res.writeContinue();
            }

            req.resume(); // <--- CRITICAL FIX: mitm-proxy pauses the request by default!

            const reqChunks = [];
            req.on('data', (chunk) => {
                reqChunks.push(chunk);
            });

            req.on('end', async () => {
                const reqBody = Buffer.concat(reqChunks);

                // 动态解析目标 Host 和 Path
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

                // 特殊兜底逻辑：处理直连本地的请求
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

                // 提取模型名称
                let currentModel = 'unknown';
                const modelMatch = targetPath.match(/\/models\/([^:]+)/);
                if (modelMatch) {
                    currentModel = modelMatch[1];
                } else if (targetPath.includes('streamGenerateContent')) {
                    currentModel = 'antigravity-core';
                }

                // 记录完整请求日志
                const timestampReq = new Date().toISOString();
                const reqLogStr = `[${timestampReq}] ${req.method} ${targetHost}${targetPath}\nHeaders: ${JSON.stringify(req.headers, null, 2)}\n\nPayload:\n${reqBody.toString('utf8')}`;
                this.saveLog('req', reqLogStr);

                // 打印 Payload
                if (reqBody.length > 0) {
                    const safeString = reqBody.toString('utf8').replace(/[^\x20-\x7E一-龥]/g, '');
                    const preview = safeString.length > 150 ? safeString.substring(0, 150) + '...' : safeString;
                    this.emit('log', `${logPrefix} Payload: ${preview}`);
                } else {
                    this.emit('log', `${logPrefix}`);
                }

                const attemptRequest = (attemptIndex) => {
                    return new Promise((resolve, reject) => {
                        const options = {
                            hostname: targetHost,
                            port: 443,
                            path: targetPath,
                            method: req.method,
                            headers: {
                                ...req.headers,
                                host: targetHost,
                            },
                            rejectUnauthorized: false
                        };

                        const proxyReq = https.request(options, (proxyRes) => {
                            // 1) 503 错误处理
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

                                    const timestampRes = new Date().toISOString();
                                    const resLogStr = `[${timestampRes}] ${proxyRes.statusCode} ${targetHost}${targetPath}\nHeaders: ${JSON.stringify(proxyRes.headers, null, 2)}\n\nBody:\n${bodyStr}`;
                                    this.saveLog('res', resLogStr);

                                    if (bodyStr.includes('MODEL_CAPACITY_EXHAUSTED')) {
                                        reject(new Error('CAPACITY_EXHAUSTED'));
                                    } else {
                                        resolve({ isRetryable: false, proxyRes, bodyBuffer: resBody });
                                    }
                                });
                                return;
                            }

                            // 2) 统一嗅探所有的 Response 记录响应日志并解析 Token
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
                                const timestampRes = new Date().toISOString();
                                const resLogStr = `[${timestampRes}] ${proxyRes.statusCode} ${targetHost}${targetPath}\nHeaders: ${JSON.stringify(proxyRes.headers, null, 2)}\n\nBody:\n${fullBodyStr}`;
                                this.saveLog('res', resLogStr);

                                if (proxyRes.statusCode === 200 && targetPath.includes('GenerateContent')) {
                                    try {
                                        let inTokens = 0, outTokens = 0, cachedTokens = 0;
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
                                            this.emit('log', `📊 [${currentModel}] Usage: ${inTokens} In | ${outTokens} Out | ${cachedTokens} Cached (Hit rate: ${((cachedTokens/(inTokens+cachedTokens||1))*100).toFixed(1)}%)`);
                                        }
                                    } catch (err) {}
                                }
                            });

                            resolve({ isRetryable: false, proxyRes: clientStream });
                        });

                        proxyReq.on('error', (e) => reject(e));

                        if (reqBody.length > 0) {
                            proxyReq.write(reqBody);
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

        // 启动 Proxy 并监听端口，CA 证书目录设定在应用数据目录下
        const caDir = path.join(app.getPath('userData'), 'certs');
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
            this.emit('log', `📁 Payload logs saved to: ${app.getPath('userData')}`);
            
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
        }
    }
}

module.exports = ProxyEngine;
