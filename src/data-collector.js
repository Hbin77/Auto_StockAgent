const yahooFinance = require('yahoo-finance2').default;
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'data-collector.log' })
    ]
});

class DataCollector {
    constructor() {
        // Suppress yahoo-finance2 notice
        yahooFinance.suppressNotices(['yahooSurvey']);
    }

    /**
     * Fetch OHLCV data for a given symbol
     * @param {string} symbol 
     * @param {string} interval - '1d', '5m', etc.
     * @param {number} periodDays - Number of days of history to fetch (approx)
     */
    async fetchMarketData(symbol, interval = '1d', periodDays = 60) {
        try {
            const queryOptions = {
                period1: new Date(Date.now() - (periodDays * 24 * 60 * 60 * 1000)), // X days ago
                interval: interval
            };

            // Use chart() for better intraday support (1m, 5m, etc.)
            const result = await yahooFinance.chart(symbol, queryOptions);

            // chart() returns { meta, quotes, ... } or sometimes just array depending on version/options.
            // yahoo-finance2 chart usually returns { meta, quotes }
            if (result && result.quotes) {
                return result.quotes;
            }
            return [];
        } catch (error) {
            logger.error(`Error fetching data for ${symbol}: ${error.message}`);
            return [];
        }
    }

    /**
     * Fetch current quote for real-time price
     * @param {string} symbol 
     */
    async fetchQuote(symbol) {
        try {
            const quote = await yahooFinance.quote(symbol);
            return quote;
        } catch (error) {
            logger.error(`Error fetching quote for ${symbol}: ${error.message}`);
            return null;
        }
    }
}

module.exports = new DataCollector();
