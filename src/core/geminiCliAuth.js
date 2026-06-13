const http = require('http');
const { shell } = require('electron');
const url = require('url');
const https = require('https');
const accountManager = require('./accountManager');
const credentials = require('./credentials');

const CLIENT_ID = credentials.gemini_cli.client_id;
const CLIENT_SECRET = credentials.gemini_cli.client_secret;

class GeminiCliAuth {
    constructor() {
        this.server = null;
    }

    startLogin() {
        return new Promise((resolve, reject) => {
            if (this.server) {
                this.server.close();
            }

            // Create a temporary local server to receive the OAuth callback
            this.server = http.createServer(async (req, res) => {
                try {
                    const parsedUrl = url.parse(req.url, true);

                    if (parsedUrl.pathname === '/') {
                        const code = parsedUrl.query.code;

                        if (code) {
                            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end('<html><body><h2>登录成功！您可以关闭此页面并返回 Antigravity Proxy。</h2><script>window.close()</script></body></html>');

                            // ⚠️ 关键修复：必须在 server.close() 之前保存 port，
                            // 因为 exchangeCodeForToken 内的 redirect_uri 必须与授权时完全一致
                            const callbackPort = this.server.address().port;
                            const callbackRedirectUri = `http://127.0.0.1:${callbackPort}/`;

                            this.server.close();
                            this.server = null;

                            // Exchange code for tokens
                            try {
                                const tokenData = await this.exchangeCodeForToken(code, callbackRedirectUri);
                                if (tokenData && tokenData.access_token) {
                                    // Fetch user info (email)
                                    const email = await this.getUserEmail(tokenData.access_token);

                                    accountManager.addAccount({
                                        email: email || 'Unknown Account',
                                        access_token: tokenData.access_token,
                                        refresh_token: tokenData.refresh_token || null,
                                        provider: 'gemini-cli'
                                    });
                                    resolve({ success: true, email, provider: 'gemini-cli' });
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
                    }
                } catch (err) {
                    console.error('[GeminiCliAuth] Error processing callback:', err);
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end('Internal Server Error');
                    }
                }
            });

            this.server.listen(0, '127.0.0.1', () => {
                const port = this.server.address().port;
                const redirectUri = `http://127.0.0.1:${port}/`;

                // Construct Google OAuth URL
                const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&response_type=code&scope=openid%20https://www.googleapis.com/auth/userinfo.email%20https://www.googleapis.com/auth/userinfo.profile%20https://www.googleapis.com/auth/cloud-platform&redirect_uri=${encodeURIComponent(redirectUri)}&access_type=offline&prompt=consent`;

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
                    'Authorization': `Bearer ${accessToken}`
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
}

module.exports = new GeminiCliAuth();
