/**
 * Antigravity Proxy - Shared Dashboard State
 */

const state = {
    // Basic State Variables
    currentLanguage: 'zh',
    currentTheme: 'light',
    activeTab: 'logs',
    trendsData: [],
    allRequests: [],
    searchQuery: '',
    currentRange: '24h',
    customStartDate: null,
    customEndDate: null,
    quotaCache: {},
    currentAccountsList: [],
    currentActiveChannel: 'antigravity',
    lastBackendData: null,
    currentViewTab: '',
    memoryHistory: [],
    maxMemoryHistoryPoints: 25,

    // Pagination
    currentPage: 1,
    itemsPerPage: 8,

    // Pricing Config Cache
    pricingConfig: {},

    // UI Interactive States
    isLoadingAuth: false,
    isRefreshingAll: false,
    isRefreshingAggregate: false,

    // Shared Callbacks for Cross-Module Communication
    // These will be registered by the controllers during initialization
    callbacks: {
        renderLogsTable: () => {},
        renderAccounts: () => {},
        updateAggregateQuotaUI: () => {},
        fetchPricing: () => {},
        setLanguage: () => {},
        updateStatusLabel: () => {},
        refreshPacketsList: () => {},
        updateAnalyzeAccountSelect: () => {}
    }
};

module.exports = state;
