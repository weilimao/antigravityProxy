/**
 * Antigravity Proxy - Bilingual Dictionary (ZH / EN)
 */

const translations = {
    zh: {
        title: "Antigravity Proxy 控制台",
        interceptMode: "拦截模式:",
        statusOn: "开启",
        statusOff: "关闭",
        caStatus: "CA证书:",
        certTrusted: "🔒 已信任",
        certUntrusted: "⚠️ 未信任",
        certChecking: "⏳ 检查中...",
        certProcessing: "⏳ 处理中...",
        installCert: "安装证书",
        uninstallCert: "卸载证书",
        
        totalRequests: "总请求次数",
        totalTokens: "Token总使用量",
        cachedTokens: "缓存Token数量",
        cacheHitRate: "缓存命中率",
        
        input: "输入",
        output: "输出",
        savedCost: "节省成本:",
        usageTrend: "使用趋势",
        legendCost: "成本 ($)",
        legendCached: "缓存命中 (Tokens)",
        legendInput: "输入 (Tokens)",
        legendOutput: "输出 (Tokens)",
        
        tabModelStats: "模型统计",
        tabRequestLogs: "请求日志",
        
        colModel: "模型",
        colRequests: "请求次数",
        colTokens: "Tokens使用量",
        colHitRate: "缓存命中率",
        colCost: "总成本",
        colAvgCost: "平均成本",
        
        colTime: "请求时间",
        colMethodHost: "请求方式 & 域名",
        colPath: "API 接口",
        colPrice: "价格",
        colCacheStatus: "缓存状态",
        
        statusHit: "命中 (HIT)",
        statusMiss: "未命中 (MISS)",
        statusNone: "直通 (NONE)",
        
        loading: "正在加载数据...",
        noData: "暂无请求数据",
        noLogs: "暂无日志记录",
        
        logBufferTitle: "控制台系统日志",
        
        navSettings: "设置",
        settingsTitle: "系统设置",
        settingsDesc: "配置代理软件的底层行为与本地数据存储路径",
        dataDirLabel: "数据存储位置",
        dataDirTip: "所有核心数据（账号凭证、流量统计数据、计费配置、以及局域网 CA 证书）均保存在此目录中。更改此路径后，系统会自动将您之前存储的数据完整迁移至新位置。",
        currentDirLabel: "当前存储路径",
        btnChangeDir: "更改位置",
        migrationStatusTitle: "数据迁移状态",
        migrationStatusSuccess: "🎉 数据迁移成功！已重定向至新存储路径。",
        migrationStatusFailed: "❌ 迁移失败：",
        migrationStatusProcessing: "⏳ 正在迁移数据，请稍候...",
    },
    en: {
        title: "Antigravity Proxy Console",
        interceptMode: "Intercept Mode:",
        statusOn: "ON",
        statusOff: "OFF",
        caStatus: "CA Cert:",
        certTrusted: "🔒 Trusted",
        certUntrusted: "⚠️ Untrusted",
        certChecking: "⏳ Checking...",
        certProcessing: "⏳ Processing...",
        installCert: "Install CA",
        uninstallCert: "Uninstall CA",
        
        totalRequests: "Total Requests",
        totalTokens: "Total Tokens",
        cachedTokens: "Cached Tokens",
        cacheHitRate: "Cache Hit Rate",
        
        input: "Input",
        output: "Output",
        savedCost: "Saved Cost:",
        usageTrend: "Usage Trend",
        legendCost: "Cost ($)",
        legendCached: "Cached (Tokens)",
        legendInput: "Input (Tokens)",
        legendOutput: "Output (Tokens)",
        
        tabModelStats: "Model Statistics",
        tabRequestLogs: "Request Logs",
        
        colModel: "Model",
        colRequests: "Requests",
        colTokens: "Tokens",
        colHitRate: "Cache Hit Rate",
        colCost: "Total Cost",
        colAvgCost: "Avg Cost",
        
        colTime: "Time",
        colMethodHost: "Method & Host",
        colPath: "Path",
        colPrice: "Price",
        colCacheStatus: "Cache Status",
        
        statusHit: "HIT",
        statusMiss: "MISS",
        statusNone: "NONE",
        
        loading: "Loading data...",
        noData: "No data available",
        noLogs: "No logs recorded",
        
        logBufferTitle: "Console System Log",
        
        navSettings: "Settings",
        settingsTitle: "System Settings",
        settingsDesc: "Configure underlying behaviors and local data storage path.",
        dataDirLabel: "Data Directory",
        dataDirTip: "All core data (credentials, request logs, model pricing, and local CA certificates) are saved in this directory. When updated, existing data will be automatically migrated to the new location.",
        currentDirLabel: "Current Path",
        btnChangeDir: "Change Location",
        migrationStatusTitle: "Data Migration Status",
        migrationStatusSuccess: "🎉 Migration completed successfully! Redirected to the new path.",
        migrationStatusFailed: "❌ Migration failed: ",
        migrationStatusProcessing: "⏳ Migrating data, please wait...",
    }
};

module.exports = translations;
