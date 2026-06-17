/**
 * Antigravity Proxy - Packet Capturer & AI Analyzer Module
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const accountManager = require('./accountManager');

/**
 * 递归提取 JSON 对象的所有字段路径
 * @param {any} obj 
 * @param {string} prefix 
 * @returns {string[]}
 */
function extractFieldPaths(obj, prefix = '') {
    if (obj === null || obj === undefined) return [];
    
    let paths = [];
    if (Array.isArray(obj)) {
        const currentPath = prefix ? `${prefix}[]` : '[]';
        paths.push(currentPath);
        
        // 收集数组中所有元素（通常是对象）的合并字段
        const mergedObj = {};
        let hasObjects = false;
        for (const item of obj) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                hasObjects = true;
                Object.assign(mergedObj, item);
            }
        }
        
        if (hasObjects) {
            paths = paths.concat(extractFieldPaths(mergedObj, currentPath));
        }
    } else if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            const currentPath = prefix ? `${prefix}.${key}` : key;
            paths.push(currentPath);
            paths = paths.concat(extractFieldPaths(obj[key], currentPath));
        }
    }
    
    // 去重并排序
    return [...new Set(paths)].sort();
}

/**
 * 智能截短/压缩 JSON，只保留键结构，截短长字符串和折叠长对象数组
 * @param {any} val 
 * @param {number} maxStrLen 
 * @returns {any}
 */
function smartTruncateJson(val, maxStrLen = 120) {
    if (val === null || val === undefined) {
        return val;
    }
    
    if (Array.isArray(val)) {
        if (val.length === 0) return [];
        // 判断是否是基本类型数组（如字符串数组、数字数组）
        const isPrimitiveArray = val.every(item => typeof item !== 'object' || item === null);
        if (isPrimitiveArray) {
            if (val.length > 5) {
                const head = val.slice(0, 3).map(item => {
                    if (typeof item === 'string' && item.length > maxStrLen) {
                        return item.substring(0, maxStrLen) + '...';
                    }
                    return item;
                });
                return [...head, `... [已省略其余 ${val.length - 3} 个元素]` ];
            }
            return val.map(item => {
                if (typeof item === 'string' && item.length > maxStrLen) {
                    return item.substring(0, maxStrLen) + '...';
                }
                return item;
            });
        }
        
        // 对象数组，只保留前 2 个元素作为结构参考，避免只有一个元素不够具代表性，但一般 1 到 2 个即可
        const truncatedArray = [];
        const limit = Math.min(val.length, 2);
        for (let i = 0; i < limit; i++) {
            truncatedArray.push(smartTruncateJson(val[i], maxStrLen));
        }
        if (val.length > limit) {
            truncatedArray.push(`... [已省略其余 ${val.length - limit} 个同结构元素以节省 Token]`);
        }
        return truncatedArray;
    }
    
    if (typeof val === 'object') {
        const result = {};
        for (const key of Object.keys(val)) {
            result[key] = smartTruncateJson(val[key], maxStrLen);
        }
        return result;
    }
    
    if (typeof val === 'string') {
        if (val.length > maxStrLen) {
            return val.substring(0, maxStrLen) + `... [已截断，原长度: ${val.length}]`;
        }
        return val;
    }
    
    return val;
}

class PacketCapturer {
    constructor() {
        this.persistPath = '';
        this.packets = [];
    }

    /**
     * 初始化抓包器并从磁盘加载已抓取的请求包
     * @param {string} userDataPath Electron 的 userData 目录
     */
    init(userDataPath) {
        this.persistPath = path.join(userDataPath, 'captured_packets.json');
        this.loadFromDisk();
    }

    /**
     * 更新持久化路径
     * @param {string} newPath 
     */
    updatePath(newPath) {
        this.persistPath = path.join(newPath, 'captured_packets.json');
        this.loadFromDisk();
    }

    /**
     * 从磁盘加载包列表
     */
    loadFromDisk() {
        if (!this.persistPath) return;
        try {
            if (fs.existsSync(this.persistPath)) {
                const content = fs.readFileSync(this.persistPath, 'utf8');
                this.packets = JSON.parse(content) || [];
            } else {
                this.packets = [];
            }
        } catch (e) {
            console.error('[PacketCapturer] Failed to load captured packets:', e);
            this.packets = [];
        }
    }

    /**
     * 保存包列表到磁盘
     */
    saveToDisk() {
        if (!this.persistPath) return;
        try {
            fs.writeFileSync(this.persistPath, JSON.stringify(this.packets, null, 2), 'utf8');
        } catch (e) {
            console.error('[PacketCapturer] Failed to save captured packets:', e);
        }
    }

    /**
     * 获取包的唯一键
     * @param {string} method 
     * @param {string} host 
     * @param {string} urlPath 
     */
    getPacketKey(method, host, urlPath) {
        const cleanPath = (urlPath || '/').split('?')[0];
        return `${(method || 'POST').toUpperCase()} ${host || 'unknown'}${cleanPath}`;
    }

    /**
     * 判断某个接口是否已经被成功捕获
     * @param {string} method 
     * @param {string} host 
     * @param {string} urlPath 
     */
    isCaptured(method, host, urlPath) {
        const targetKey = this.getPacketKey(method, host, urlPath);
        return this.packets.some(p => this.getPacketKey(p.method, p.host, p.path) === targetKey);
    }

    /**
     * 保存新捕获的请求包
     */
    savePacket({ method, host, path: urlPath, reqHeaders, reqBody, resHeaders, resBody, statusCode }) {
        const cleanPath = (urlPath || '/').split('?')[0];
        const targetKey = this.getPacketKey(method, host, cleanPath);
        
        // 解析 Body 为对象（如果是 JSON 字符串的话）以方便渲染
        let parsedReqBody = reqBody;
        if (typeof reqBody === 'string') {
            try {
                parsedReqBody = JSON.parse(reqBody);
            } catch (e) {}
        }
        let parsedResBody = resBody;
        if (typeof resBody === 'string') {
            try {
                parsedResBody = JSON.parse(resBody);
            } catch (e) {}
        }

        // 移除敏感信息，避免泄露/污染
        const cleanHeaders = (headers) => {
            if (!headers) return {};
            const h = { ...headers };
            const sensitiveKeys = ['authorization', 'cookie', 'x-goog-api-key', 'api-key'];
            for (const key of Object.keys(h)) {
                if (sensitiveKeys.includes(key.toLowerCase())) {
                    h[key] = '[REDACTED]';
                }
            }
            return h;
        };

        const packet = {
            id: Date.now() + '-' + Math.floor(Math.random() * 1000),
            timestamp: (() => {
                const now = new Date();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');
                const time = now.toLocaleTimeString('zh-CN', { hour12: false });
                return `${m}/${d} ${time}`;
            })(),
            method: (method || 'POST').toUpperCase(),
            host: host || 'unknown',
            path: cleanPath,
            url: `https://${host}${urlPath}`,
            reqHeaders: cleanHeaders(reqHeaders),
            reqBody: parsedReqBody,
            resHeaders: cleanHeaders(resHeaders),
            resBody: parsedResBody,
            statusCode: statusCode || 200
        };

        // 查找是否已有记录，若有则替换（其实在代理拦截时已有 isCaptured 拦截，这里双重保险）
        const existingIdx = this.packets.findIndex(p => this.getPacketKey(p.method, p.host, p.path) === targetKey);
        if (existingIdx > -1) {
            this.packets[existingIdx] = packet;
        } else {
            this.packets.unshift(packet);
        }

        this.saveToDisk();
        return packet;
    }

    /**
     * 获取所有包
     */
    getPackets() {
        return this.packets;
    }

    /**
     * 获取最新抓到的包
     */
    getLastPacket() {
        return this.packets[0] || null;
    }

    /**
     * 清空所有包
     */
    clearPackets() {
        this.packets = [];
        this.saveToDisk();
    }

    /**
     * 调用 Gemini 2.5 Flash API 分析文档
     * @param {string} accountId 账号池里的账号 ID
     */
    async analyzePackets(accountId) {
        if (this.packets.length === 0) {
            throw new Error('当前抓包日志为空，请先发起一些 API 请求！');
        }

        const account = accountManager.accounts.find(a => a.id === accountId);
        if (!account) {
            throw new Error('未找到指定的账号，请重新选择。');
        }

        let token = account.access_token;
        if (!token) {
            throw new Error('该账号暂无有效的 Access Token');
        }

        const generatePrompt = () => {
            let prompt = `你是一个最顶级的 API 架构师和技术文档工程师。
下面是我在本地抓包拦截到的通过我们代理的真实 API 请求 and 响应日志。
请你以最严谨、详实、清晰的专业态度，分析这些抓包数据，提取并归纳出所有不同的 API 接口，并输出一份完整、美观的 Markdown 格式的接口文档说明。

> [!IMPORTANT]
> **请务必严格遵守以下“全面、明明白白”的文档编写要求，绝对不能漏掉任何字段，不能含糊带过：**
> 1. **请求 Header 必须表格化逐一解释**：将抓包中的每一个请求头字段（如 Host, User-Agent, Content-Type, Authorization 等）在表格中列出，详细说明其在接口中的作用和取值（对于 Authorization 或是 API Key 等敏感信息，请解释其作为鉴权凭据的作用）。
> 2. **请求 Body 字段深度拆解**：如果请求体是 JSON 格式，必须将 **每一个** 字段路径（包括所有嵌套的父级对象、数组以及最深层的叶子字段，必须使用 \`a.b[].c\` 的形式）都在表格中逐一列出！表格必须包含：字段路径、字段名称（或简短 key 名字）、数据类型、是否必填（结合实际推断）、中文说明（结合真实业务场景，解释得清清楚楚、明明白白，说明它对模型生成或控制的具体作用）、示例值。
> 3. **响应 Body 字段深度拆解**：对于返回的 JSON 结构，同样必须在表格中将 **每一个** 响应字段路径全量列出并逐个解释，详细说清各个字段的业务含义、作用以及在开发中如何使用。
> 4. **字段实际具体值/枚举值的深度业务逆向解读**：在解释字段时，**必须结合抓到的真实具体值**（例如在响应中出现的 \`creditType: "GOOGLE_ONE_AI"\`、\`paidTier.id: "g1-pro-tier"\`、\`minimumCreditAmountForUsage: "50"\` 等等）在说明表格中做详尽的业务逻辑剖析。例如解释 \`GOOGLE_ONE_AI\` 代表什么类型的订阅积分、\`g1-pro-tier\` 的会员等级权限、\`50\` 的使用门槛限制以及其具体的业务逻辑，不允许只做英文字面直译。
> 5. **宁多勿漏，对照必填字段清单**：我们为每个接口自动提取了所有的 Body 字段路径清单。你所输出的参数说明表格中，**必须全量包含**清单中的每一个路径！如果遗漏任何一个，接口文档将视为不合格。绝对不允许使用“等等/其余字段略”等借口省略任何字段！
> 6. **请求与响应示例代码块绝对不能丢失**：对于每一个接口，必须在其定义的最末尾提供 \`请求与响应示例\` 章节，并将下方提供给你的对应请求 Body JSON 与响应 Body JSON 完整输出（使用 json 语法高亮代码块包裹），这对于调用者极其关键，绝对不可以省略！

请按照以下结构组织 Markdown 文档：
1. **接口文档整体概览**：表格展示所有 API 列表（序号、方法、路径、接口名称说明）。
2. **详细接口定义**（每个接口用独立标题拆分）：
   - **接口中文名称**（根据 Path 和业务内容推断合理好懂的名称）
   - **请求方法 (Method)** 与 **请求完整 URL 路径**
   - **请求 Headers 说明**（详细表格：字段、说明、示例）
   - **请求 Body 参数说明**（超级详细的表格：字段路径、字段名称、类型、必填、详细含义说明、示例。必须包含我们为你列出的所有请求字段路径）
   - **响应 Body 参数说明**（超级详细的表格：字段路径、字段名称、类型、详细含义说明、示例。必须包含我们为你列出的所有响应字段路径）
   - **请求与响应示例**：必须完整输出该接口的请求 JSON 与响应 JSON 代码块。你必须直接使用我们在下方提供的已经过智能压缩的 \`请求Body 示例\` 与 \`响应Body 示例\` 填充，严禁缩减、省略或用“略”字代替，确保代码块包含在生成的 Markdown 中！

下面是抓包得到的真实接口日志（共 ${this.packets.length} 个）：\n\n`;

            this.packets.forEach((p, idx) => {
                // 智能截断与格式化
                const truncatedReqBody = smartTruncateJson(p.reqBody, 120);
                const truncatedResBody = smartTruncateJson(p.resBody, 120);

                const reqBodyStr = truncatedReqBody ? JSON.stringify(truncatedReqBody, null, 2) : '{}';
                const resBodyStr = truncatedResBody ? JSON.stringify(truncatedResBody, null, 2) : '{}';

                // 提取字段路径列表
                const reqPaths = extractFieldPaths(p.reqBody);
                const resPaths = extractFieldPaths(p.resBody);

                const reqPathsMarkdown = reqPaths.length > 0 ? reqPaths.map(path => `- \`${path}\``).join('\n') : '无字段';
                const resPathsMarkdown = resPaths.length > 0 ? resPaths.map(path => `- \`${path}\``).join('\n') : '无字段';

                prompt += `---
[接口 #${idx + 1}]
Method: ${p.method}
URL: ${p.url}
请求Headers: ${JSON.stringify(p.reqHeaders, null, 2)}

【此接口必须解释的请求 Body 字段路径清单（共 ${reqPaths.length} 个，表格中必须全部包含解释）】：
${reqPathsMarkdown}

请求Body 示例（已智能折叠超长数据）:
\`\`\`json
${reqBodyStr}
\`\`\`

【此接口必须解释的响应 Body 字段路径清单（共 ${resPaths.length} 个，表格中必须全部包含解释）】：
${resPathsMarkdown}

响应Body 示例（已智能折叠超长数据）:
\`\`\`json
${resBodyStr}
\`\`\`

响应Headers: ${JSON.stringify(p.resHeaders, null, 2)}
`;
            });

            prompt += `\n直接输出最详实的 Markdown 内容，不要有任何客套废话或解释性前言，直接以漂亮的 Markdown 格式输出。`;
            return prompt;
        };

        const executeRequest = (accessToken) => {
            return new Promise((resolve, reject) => {
                const prompt = generatePrompt();
                const projectId = account.projectId || account.project_id || 'expanded-palisade-stpfc';
                
                const postData = JSON.stringify({
                    project: projectId,
                    requestId: `chat/${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
                    request: {
                        contents: [
                            {
                                role: 'user',
                                parts: [
                                    {
                                        text: prompt
                                    }
                                ]
                            }
                        ],
                        generationConfig: {
                            maxOutputTokens: 8192,
                            thinkingConfig: {
                                includeThoughts: false,
                                thinkingBudget: 0
                            }
                        },
                        sessionId: `-${Date.now()}`
                    },
                    model: 'gemini-2.5-flash-lite',
                    userAgent: 'antigravity',
                    requestType: 'chat',
                    enabledCreditTypes: [
                        'GOOGLE_ONE_AI'
                    ]
                });

                const options = {
                    hostname: 'daily-cloudcode-pa.googleapis.com',
                    port: 443,
                    path: '/v1internal:streamGenerateContent?alt=sse',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                        'Authorization': `Bearer ${accessToken}`,
                        'User-Agent': 'antigravity/ide/2.8.4 windows/amd64',
                        'X-Goog-Api-Client': 'gl-node/22.21.1'
                    },
                    rejectUnauthorized: false,
                    timeout: 120000 // 2分钟超时限制，因为抓包分析可能需要较多Token的生成
                };

                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        resolve({ statusCode: res.statusCode, body: data });
                    });
                });

                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('请求超时，Gemini 接口响应时间过长'));
                });

                req.on('error', (err) => {
                    reject(err);
                });

                req.write(postData);
                req.end();
            });
        };

        // 发送第一次尝试
        let response = await executeRequest(token);

        // 如果是 401，尝试刷新 Token 后重试
        if (response.statusCode === 401) {
            console.log(`[PacketCapturer] 账号 ${account.email} 调用 401，尝试刷新 Token...`);
            try {
                const newToken = await accountManager.refreshAccountToken(accountId);
                response = await executeRequest(newToken);
            } catch (refreshErr) {
                throw new Error(`账号 Token 过期且自动刷新失败: ${refreshErr.message}`);
            }
        }

        if (response.statusCode !== 200) {
            let errorMsg = `HTTP Error ${response.statusCode}`;
            try {
                const errJson = JSON.parse(response.body);
                if (errJson.error && errJson.error.message) {
                    errorMsg = errJson.error.message;
                }
            } catch (e) {}
            throw new Error(`Gemini 分析接口返回错误: ${errorMsg}`);
        }

        // 解析接口返回的 Markdown 文本 (支持 SSE 格式合并)
        try {
            const bodyStr = response.body.trim();
            if (bodyStr.startsWith('data:')) {
                let fullText = '';
                const lines = bodyStr.split('\n');
                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (cleanLine.startsWith('data:')) {
                        try {
                            const jsonStr = cleanLine.substring(5).trim();
                            const data = JSON.parse(jsonStr);
                            const resObj = data.response || data;
                            const text = resObj.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (text) {
                                fullText += text;
                            }
                        } catch (e) {}
                    }
                }
                if (!fullText) {
                    throw new Error('SSE 响应中未包含任何文本内容');
                }
                return fullText;
            } else {
                const respJson = JSON.parse(bodyStr);
                const resObj = respJson.response || respJson;
                const markdown = resObj.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!markdown) {
                    throw new Error('Gemini 未返回合法的文本内容');
                }
                return markdown;
            }
        } catch (e) {
            throw new Error(`解析 Gemini 响应数据失败: ${e.message}\n原始响应为: ${response.body.substring(0, 300)}`);
        }
    }
}

module.exports = new PacketCapturer();
