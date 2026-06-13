const http = require('http');
const { shell } = require('electron');
const url = require('url');
const https = require('https');
const accountManager = require('./accountManager');
const credentials = require('./credentials');

const CLIENT_ID = credentials.antigravity.client_id;
const CLIENT_SECRET = credentials.antigravity.client_secret;
const CALLBACK_PORT = 38121; // fixed port for Antigravity

const SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
];

class AntigravityAuth {
    constructor() {
        this.server = null;
    }

    // Helper: Fake user agent like in CLIProxyAPI
    getAntigravityUserAgent() {
        return 'Code-Assist/1.22.4 (JetBrains; Windows 11 10.0; x86_64) cloudaicompanion/1.22.4';
    }

    startLogin() {
        return new Promise((resolve, reject) => {
            if (this.server) {
                this.server.close();
            }

            // Create a temporary local server to receive the OAuth callback on the fixed port
            this.server = http.createServer(async (req, res) => {
                try {
                    const parsedUrl = url.parse(req.url, true);

                    if (parsedUrl.pathname === '/oauth-callback' || parsedUrl.pathname === '/') {
                        const code = parsedUrl.query.code;

                        if (code) {
                            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end('<html><body><h2>Antigravity 登录成功！您可以关闭此页面并返回 Proxy。</h2><script>window.close()</script></body></html>');

                            const callbackRedirectUri = `http://127.0.0.1:${CALLBACK_PORT}/oauth-callback`;

                            this.server.close();
                            this.server = null;

                            // Exchange code for tokens
                            try {
                                const tokenData = await this.exchangeCodeForToken(code, callbackRedirectUri);
                                if (tokenData && tokenData.access_token) {
                                    // Fetch user info (email)
                                    const email = await this.getUserEmail(tokenData.access_token);

                                    try {
                                        const projectId = await this.activateProject(tokenData.access_token);
                                        accountManager.addAccount({
                                            email: email || 'Unknown Account',
                                            access_token: tokenData.access_token,
                                            refresh_token: tokenData.refresh_token || null,
                                            provider: 'antigravity',
                                            project_id: projectId // 假设 accountManager 可以接收多余的属性
                                        });
                                        resolve({ success: true, email, provider: 'antigravity' });
                                    } catch (err) {
                                        console.warn('[AntigravityAuth] Account activation loadCodeAssist failed, but continuing:', err.message);
                                        accountManager.addAccount({
                                            email: email || 'Unknown Account',
                                            access_token: tokenData.access_token,
                                            refresh_token: tokenData.refresh_token || null,
                                            provider: 'antigravity'
                                        });
                                        resolve({ success: true, email, provider: 'antigravity' });
                                    }
                                } else {
                                    const errMsg = tokenData && tokenData.error_description
                                        ? tokenData.error_description
                                        : (tokenData && tokenData.error ? tokenData.error : 'Unknown error');
                                    reject(new Error(`Failed to obtain access token: ${errMsg}`));
                                }
                            } catch (err) {
                                reject(err);
                            }
                        } else {
                            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end('<html><body><h2>登录失败：未收到授权码。</h2></body></html>');
                            reject(new Error('No code received'));
                        }
                    } else {
                        res.writeHead(404);
                        res.end('Not Found');
                    }
                } catch (err) {
                    console.error('[AntigravityAuth] Error processing callback:', err);
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end('Internal Server Error');
                    }
                }
            });

            this.server.on('error', (e) => {
                if (e.code === 'EADDRINUSE') {
                    reject(new Error(`Port ${CALLBACK_PORT} is already in use. Cannot start OAuth callback server.`));
                } else {
                    reject(e);
                }
            });

            this.server.listen(CALLBACK_PORT, '127.0.0.1', () => {
                const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}/oauth-callback`;

                // Construct Google OAuth URL
                const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&response_type=code&scope=${encodeURIComponent(SCOPES.join(' '))}&redirect_uri=${encodeURIComponent(redirectUri)}&access_type=offline&prompt=consent`;

                // Open in system browser
                shell.openExternal(authUrl);
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                if (this.server) {
                    this.server.close();
                    this.server = null;
                    reject(new Error('Login timeout'));
                }
            }, 5 * 60 * 1000);
        });
    }

    exchangeCodeForToken(code, redirectUri) {
        return new Promise((resolve, reject) => {

            const postData = new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri
            }).toString();

            const options = {
                hostname: 'oauth2.googleapis.com',
                port: 443,
                path: '/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', (e) => reject(e));
            req.write(postData);
            req.end();
        });
    }

    getUserEmail(accessToken) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'www.googleapis.com',
                port: 443,
                path: '/oauth2/v2/userinfo',
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': this.getAntigravityUserAgent()
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.email || 'Unknown');
                    } catch (e) {
                        resolve('Unknown');
                    }
                });
            });

            req.on('error', () => resolve('Unknown'));
            req.end();
        });
    }

    activateProject(accessToken) {
        return new Promise((resolve, reject) => {
            const userAgent = this.getAntigravityUserAgent();
            const loadReqBody = JSON.stringify({
                metadata: {
                    ide_type: 'ANTIGRAVITY',
                    ide_version: '1.22.4',
                    ide_name: 'antigravity'
                }
            });

            const options = {
                hostname: 'cloudcode-pa.googleapis.com',
                port: 443,
                path: '/v1internal:loadCodeAssist',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': userAgent,
                    'X-Goog-Api-Client': 'gl-go/1.21.0 gccl/0.1.0',
                    'Content-Length': Buffer.byteLength(loadReqBody)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            let projectId = '';
                            if (parsed.cloudaicompanionProject) {
                                if (typeof parsed.cloudaicompanionProject === 'string') {
                                    projectId = parsed.cloudaicompanionProject;
                                } else if (parsed.cloudaicompanionProject.id) {
                                    projectId = parsed.cloudaicompanionProject.id;
                                }
                            }

                            if (projectId) {
                                resolve(projectId);
                                return;
                            }

                            // If not found, try onboardUser flow (simplified)
                            if (parsed.allowedTiers && parsed.allowedTiers.length > 0) {
                                const tierId = parsed.allowedTiers.find(t => t.isDefault)?.id || 'legacy-tier';
                                this.onboardUser(accessToken, tierId, loadReqBody).then(resolve).catch(reject);
                                return;
                            }

                            resolve('');
                        } catch (e) {
                             resolve('');
                        }
                    } else {
                        reject(new Error(`Activation failed with status ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(loadReqBody);
            req.end();
        });
    }

    onboardUser(accessToken, tierId, metadataString) {
        return new Promise((resolve, reject) => {
            const userAgent = this.getAntigravityUserAgent();
            const onboardBody = JSON.stringify({
                tierId: tierId,
                metadata: JSON.parse(metadataString).metadata
            });

            const options = {
                hostname: 'cloudcode-pa.googleapis.com',
                port: 443,
                path: '/v1internal:onboardUser',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': userAgent,
                    'X-Goog-Api-Client': 'gl-go/1.21.0 gccl/0.1.0',
                    'Content-Length': Buffer.byteLength(onboardBody)
                }
            };

            let attempts = 0;
            const doRequest = () => {
                attempts++;
                if (attempts > 3) {
                    console.warn('[AntigravityAuth] onboardUser failed after 3 attempts.');
                    resolve('');
                    return;
                }

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.error) {
                                console.warn('[AntigravityAuth] onboardUser returned error:', parsed.error);
                                resolve('');
                                return;
                            }
                            if (parsed.done && parsed.response && parsed.response.cloudaicompanionProject) {
                                let projectId = '';
                                if (typeof parsed.response.cloudaicompanionProject === 'string') {
                                    projectId = parsed.response.cloudaicompanionProject;
                                } else if (parsed.response.cloudaicompanionProject.id) {
                                    projectId = parsed.response.cloudaicompanionProject.id;
                                }
                                resolve(projectId);
                                return;
                            }
                            // Not done yet, retry in 2 seconds
                            setTimeout(doRequest, 2000);
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                req.on('error', reject);
                req.write(onboardBody);
                req.end();
            };

            doRequest();
        });
    }
}

module.exports = new AntigravityAuth();
