/**
 * Antigravity Proxy - Model Token Pricing & Cost Calculator
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// The 8 specific models requested by the user from the dropdown list with official API rates per 1M tokens
const DEFAULT_PRICING = {
    'gemini 3.5 flash (medium)': { input: 1.50, output: 9.00, cached: 0.375 },
    'gemini 3.5 flash (high)': { input: 1.50, output: 9.00, cached: 0.375 },
    'gemini 3.5 flash (low)': { input: 1.50, output: 9.00, cached: 0.375 },
    'gemini 3.1 pro (low)': { input: 2.00, output: 12.00, cached: 0.50 },
    'gemini 3.1 pro (high)': { input: 2.00, output: 12.00, cached: 0.50 },
    'claude sonnet 4.6 (thinking)': { input: 3.00, output: 15.00, cached: 0.75 },
    'claude opus 4.6 (thinking)': { input: 5.00, output: 25.00, cached: 1.25 },
    'gpt-oss 120b (medium)': { input: 0.15, output: 0.60, cached: 0.0375 },
    'unknown': { input: 1.00, output: 3.00, cached: 0.25 }
};

let currentPricing = { ...DEFAULT_PRICING };
let pricingFilePath = null;
let customUserDataPath = null;

function init(userDataPath) {
    customUserDataPath = userDataPath;
    pricingFilePath = null;
    initialized = false;
}

function updatePath(newPath) {
    init(newPath);
}

function getPricingFilePath() {
    if (!pricingFilePath) {
        const rootDir = customUserDataPath || app.getPath('userData');
        pricingFilePath = path.join(rootDir, 'pricing.json');
    }
    return pricingFilePath;
}

function loadPricing() {
    try {
        const filePath = getPricingFilePath();
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            // Auto-migrate: if the old file has keys that do not belong to the new list, reset to defaults
            if (data['deepseek-v3'] || data['gemini-3.5-flash'] || !data['gemini 3.5 flash (medium)']) {
                currentPricing = { ...DEFAULT_PRICING };
                savePricing();
            } else {
                currentPricing = { ...DEFAULT_PRICING, ...data };
            }
        } else {
            currentPricing = { ...DEFAULT_PRICING };
        }
    } catch (e) {
        console.error('Failed to load pricing configurations:', e);
        currentPricing = { ...DEFAULT_PRICING };
    }
}

function savePricing() {
    try {
        const filePath = getPricingFilePath();
        fs.writeFileSync(filePath, JSON.stringify(currentPricing, null, 4), 'utf8');
    } catch (e) {
        console.error('Failed to save pricing configurations:', e);
    }
}

let initialized = false;
function ensureInitialized() {
    if (!initialized) {
        loadPricing();
        initialized = true;
    }
}

/**
 * Returns all pricing configurations
 * @returns {object} pricing config dictionary
 */
function getAllPricing() {
    ensureInitialized();
    return currentPricing;
}

/**
 * Finds the closest matching pricing scheme for a model name
 * @param {string} modelName 
 * @returns {object} pricing config
 */
function getPricingForModel(modelName) {
    ensureInitialized();
    if (!modelName) return currentPricing['unknown'];
    
    const name = modelName.toLowerCase().trim();
    
    // Exact mapping logic for specific models requested by the user
    const exactMappings = {
        'gemini-3-flash-agent': 'gemini 3.5 flash (high)',
        'gemini-3.5-flash-low': 'gemini 3.5 flash (medium)',
        'gemini-3.5-flash-extra-low': 'gemini 3.5 flash (low)',
        'gemini-pro-agent': 'gemini 3.1 pro (high)',
        'gemini-3.1-pro-low': 'gemini 3.1 pro (low)',
        'claude-sonnet-4-6': 'claude sonnet 4.6 (thinking)',
        'claude-opus-4-6-thinking': 'claude opus 4.6 (thinking)',
        'gpt-oss-120b-medium': 'gpt-oss 120b (medium)'
    };
    
    if (exactMappings[name]) {
        const targetKey = exactMappings[name];
        if (currentPricing[targetKey]) {
            return currentPricing[targetKey];
        }
    }
    
    // Check direct matches first
    if (currentPricing[name]) {
        return currentPricing[name];
    }
    
    // Fuzzy matching
    if (name.includes('gemini 3.5 flash') || name.includes('gemini-3.5-flash')) {
        if (name.includes('high')) return currentPricing['gemini 3.5 flash (high)'] || currentPricing['gemini 3.5 flash (medium)'];
        if (name.includes('low')) return currentPricing['gemini 3.5 flash (low)'] || currentPricing['gemini 3.5 flash (medium)'];
        return currentPricing['gemini 3.5 flash (medium)'];
    }
    if (name.includes('gemini 3.1 pro') || name.includes('gemini-3.1-pro')) {
        if (name.includes('high')) return currentPricing['gemini 3.1 pro (high)'] || currentPricing['gemini 3.1 pro (low)'];
        return currentPricing['gemini 3.1 pro (low)'];
    }
    if (name.includes('claude sonnet 4.6') || name.includes('sonnet 4.6') || (name.includes('sonnet') && name.includes('thinking'))) {
        return currentPricing['claude sonnet 4.6 (thinking)'];
    }
    if (name.includes('claude opus 4.6') || name.includes('opus 4.6') || (name.includes('opus') && name.includes('thinking'))) {
        return currentPricing['claude opus 4.6 (thinking)'];
    }
    if (name.includes('gpt-oss 120b') || name.includes('gpt-oss-120b') || name.includes('oss 120b') || name.includes('oss-120b')) {
        return currentPricing['gpt-oss 120b (medium)'];
    }
    
    // Fallback fuzzy match for general families if they don't match specific ones
    if (name.includes('flash')) {
        return currentPricing['gemini 3.5 flash (medium)'];
    }
    if (name.includes('pro')) {
        return currentPricing['gemini 3.1 pro (low)'];
    }
    if (name.includes('sonnet')) {
        return currentPricing['claude sonnet 4.6 (thinking)'];
    }
    if (name.includes('opus')) {
        return currentPricing['claude opus 4.6 (thinking)'];
    }
    
    return currentPricing['unknown'];
}

/**
 * Calculates cost of a request based on tokens consumed and cached
 * @param {string} modelName 
 * @param {number} inTokens Total prompt tokens (including cached)
 * @param {number} outTokens Output tokens
 * @param {number} cachedTokens Cached prompt tokens
 * @returns {number} calculated cost in USD
 */
function calculateCost(modelName, inTokens, outTokens, cachedTokens = 0) {
    return calculateCostBreakdown(modelName, inTokens, outTokens, cachedTokens).totalCost;
}

/**
 * Calculates cost breakdown for input / output / cached tokens
 * @param {string} modelName
 * @param {number} inTokens Total prompt tokens (including cached)
 * @param {number} outTokens Output tokens
 * @param {number} cachedTokens Cached prompt tokens
 * @returns {{inputCost:number, outputCost:number, cachedCost:number, totalCost:number, nonCachedIn:number}}
 */
function calculateCostBreakdown(modelName, inTokens, outTokens, cachedTokens = 0) {
    const pricing = getPricingForModel(modelName);
    const nonCachedIn = Math.max(0, inTokens - cachedTokens);
    const inputCost = parseFloat((nonCachedIn * pricing.input / 1000000).toFixed(6));
    const outputCost = parseFloat((outTokens * pricing.output / 1000000).toFixed(6));
    const cachedCost = parseFloat((cachedTokens * pricing.cached / 1000000).toFixed(6));
    const totalCost = parseFloat((inputCost + outputCost + cachedCost).toFixed(6));

    return {
        inputCost,
        outputCost,
        cachedCost,
        totalCost,
        nonCachedIn
    };
}

/**
 * Updates pricing for a specific model key
 * @param {string} modelKey 
 * @param {object} pricingData {input, output, cached}
 */
function updateModelPricing(modelKey, pricingData) {
    ensureInitialized();
    currentPricing[modelKey.toLowerCase()] = {
        input: parseFloat(pricingData.input),
        output: parseFloat(pricingData.output),
        cached: parseFloat(pricingData.cached)
    };
    savePricing();
}

/**
 * Deletes pricing for a custom model
 * @param {string} modelKey 
 * @returns {boolean} true if deleted
 */
function deleteModelPricing(modelKey) {
    ensureInitialized();
    const key = modelKey.toLowerCase();
    if (currentPricing[key] && key !== 'unknown') {
        delete currentPricing[key];
        savePricing();
        return true;
    }
    return false;
}

/**
 * Resets pricing to defaults
 */
function resetPricingToDefault() {
    currentPricing = { ...DEFAULT_PRICING };
    try {
        const filePath = getPricingFilePath();
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        console.error('Failed to reset pricing configurations file:', e);
    }
}

module.exports = {
    init,
    updatePath,
    calculateCost,
    calculateCostBreakdown,
    getPricingForModel,
    getAllPricing,
    updateModelPricing,
    deleteModelPricing,
    resetPricingToDefault
};
