const config = require('./config');
const dataCollector = require('./data-collector');
const stockTools = require('./stock-tools');
const dayTradingMonitor = require('./daytrading-signal-monitor');
const multiFactorScreener = require('./multi-factor-screener');
const newsAnalyzer = require('./news-analyzer');
const kisApi = require('./kis-api');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.simple()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'trade.log' })
    ]
});

class Trader {
    async start() {
        logger.info('Starting Trading Cycle...');

        // 1. Get Tickers
        const tickers = [...config.tickers.nasdaq100, ...config.tickers.sp500];

        // 2. Iterate and Analyze
        for (const symbol of tickers) {
            await this.processSymbol(symbol);
        }

        logger.info('Trading Cycle Completed.');
    }

    async processSymbol(symbol) {
        try {
            // Fetch Data
            const historicalData = await dataCollector.fetchMarketData(symbol, '5m', 5); // 5 days of 5m data
            if (historicalData.length < 50) {
                logger.warn(`Insufficient data for ${symbol}`);
                return;
            }

            // Analyze
            const basicAnalysis = stockTools.analyze(historicalData);
            const dayTradingAnalysis = dayTradingMonitor.analyze(historicalData);
            const newsAnalysis = await newsAnalyzer.analyzeNews(symbol);

            // Fundamental Data (Mock or fetch if available in quote)
            const quote = await dataCollector.fetchQuote(symbol);
            const fundamentalData = {
                peRatio: quote ? quote.trailingPE : null,
                pegRatio: quote ? quote.pegRatio : null,
                marketCap: quote ? quote.marketCap : null
            };

            // Score
            const screeningResult = multiFactorScreener.calculateScore(dayTradingAnalysis, fundamentalData);

            logger.info(`Analysis for ${symbol}: Score ${screeningResult.totalScore} (${screeningResult.recommendation})`);

            // Execute Trade
            await this.executeTrade(symbol, screeningResult, quote ? quote.regularMarketPrice : basicAnalysis.price);

        } catch (error) {
            logger.error(`Error processing ${symbol}: ${error.message}`);
        }
    }

    async executeTrade(symbol, screeningResult, currentPrice) {
        // Simple logic: 
        // Strong Buy -> Buy
        // Sell -> Sell (if holding exists)

        if (screeningResult.recommendation === 'STRONG_BUY') {
            // Check balance (Mock check for now or real API call)
            // const balance = await kisApi.getBalance();
            // if (balance && balance.buyingPower > currentPrice) ...

            logger.info(`[SIGNAL] BUY ${symbol} @ ${currentPrice}`);

            // Execute Buy Order (1 share for demo)
            // await kisApi.placeOrder(symbol, 'BUY', 1, currentPrice);
        }
        else if (screeningResult.recommendation === 'SELL') {
            logger.info(`[SIGNAL] SELL ${symbol} @ ${currentPrice}`);

            // Execute Sell Order
            // await kisApi.placeOrder(symbol, 'SELL', 1, currentPrice);
        }
    }
}

module.exports = new Trader();
