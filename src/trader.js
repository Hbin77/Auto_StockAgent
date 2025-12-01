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

        // 0. Get Account Balance & Holdings
        let accountData = await kisApi.getBalance();
        let buyingPower = accountData.buyingPower;
        let holdings = accountData.holdings;

        logger.info(`Current Balance (USD): $${buyingPower}`);
        logger.info(`Current Holdings: ${holdings.map(h => `${h.symbol}(h.qty)`).join(', ') || 'None'}`);

        // 1. Get Tickers
        // 1. Get Tickers (Use Set to avoid duplicates if lists overlap)
        const allTickers = [...new Set([...config.tickers.nasdaq100, ...config.tickers.sp500])];
        logger.info(`Total Tickers: ${allTickers.length}`);

        // 2. Pre-filter: Check Budget
        // If buyingPower is very low (e.g. < $10), we can't buy anything meaningful.
        // But we might want to SELL existing holdings.
        // So we split the list: Holdings (always check) + Affordable Candidates.

        const holdingSymbols = holdings.map(h => h.symbol);

        // Fetch quotes for ALL tickers to filter by price
        // Batching requests to avoid URL length limits if list is huge (500 is fine usually, but let's be safe)
        logger.info('Fetching real-time prices for budget filtering...');
        let affordableTickers = [];

        // Split into chunks of 500 (yahoo finance might handle it, but let's try full list first or chunk it)
        // Yahoo Finance quote array limit is often around 500-1000 chars or symbols. 
        // Let's chunk by 50 just to be safe and robust.
        const chunkSize = 50;
        for (let i = 0; i < allTickers.length; i += chunkSize) {
            const chunk = allTickers.slice(i, i + chunkSize);
            const quotes = await dataCollector.fetchQuotes(chunk);

            for (const quote of quotes) {
                // If we hold it, we must analyze it (to potentially sell).
                // If we don't hold it, we only analyze if price <= buyingPower.
                const isHeld = holdingSymbols.includes(quote.symbol);
                const price = quote.regularMarketPrice;

                if (isHeld || (price && price <= buyingPower)) {
                    affordableTickers.push(quote.symbol);
                }
            }
            // Small delay between chunks
            await new Promise(r => setTimeout(r, 100));
        }

        // Remove duplicates just in case
        affordableTickers = [...new Set(affordableTickers)];
        logger.info(`Affordable/Held Tickers to Analyze: ${affordableTickers.length} / ${allTickers.length}`);

        // 3. Iterate and Analyze (Only Affordable/Held)
        for (const symbol of affordableTickers) {
            // Update buyingPower after each trade decision to avoid overdraft in same cycle
            const tradeResult = await this.processSymbol(symbol, buyingPower, holdings);
            if (tradeResult && tradeResult.action === 'BUY') {
                buyingPower -= tradeResult.cost;
            }

            // Throttling: Wait 300ms between requests to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        logger.info('Trading Cycle Completed.');
    }

    async processSymbol(symbol, buyingPower, holdings) {
        try {
            // Fetch Data
            const historicalData = await dataCollector.fetchMarketData(symbol, '5m', 5);
            if (historicalData.length < 50) {
                // logger.warn(`Insufficient data for ${symbol}`);
                return null;
            }

            // Analyze
            // Analyze
            const basicAnalysis = stockTools.analyze(historicalData);
            const dayTradingAnalysis = dayTradingMonitor.analyze(historicalData);

            // Optimization: Only fetch news if Technical Score is decent (> 0)
            // This saves API calls and time for stocks that are technically weak anyway.
            let newsAnalysis = null;
            if (dayTradingAnalysis.score > 0) {
                newsAnalysis = await newsAnalyzer.analyzeNews(symbol);
            } else {
                // logger.debug(`Skipping news for ${symbol} due to low technical score`);
            }

            // Fundamental Data
            const quote = await dataCollector.fetchQuote(symbol);
            const fundamentalData = {
                peRatio: quote ? quote.trailingPE : null,
                pegRatio: quote ? quote.pegRatio : null,
                marketCap: quote ? quote.marketCap : null
            };

            // Score
            const screeningResult = multiFactorScreener.calculateScore(dayTradingAnalysis, fundamentalData, newsAnalysis);
            const currentPrice = quote ? quote.regularMarketPrice : basicAnalysis.price;

            // logger.info(`Analysis for ${symbol}: Score ${screeningResult.totalScore} (${screeningResult.recommendation})`);
            logger.info(`Analysis for ${symbol}: Score ${screeningResult.totalScore} (${screeningResult.recommendation}) [Tech:${screeningResult.breakdown.technical} Mom:${screeningResult.breakdown.momentum} Fund:${screeningResult.breakdown.fundamental} News:${screeningResult.breakdown.sentiment}]`);

            // Execute Trade Logic
            return await this.executeTrade(symbol, screeningResult, currentPrice, buyingPower, holdings, quote);

        } catch (error) {
            logger.error(`Error processing ${symbol}: ${error.message}`);
            return null;
        }
    }

    async executeTrade(symbol, screeningResult, currentPrice, buyingPower, holdings, quote) {
        const holding = holdings.find(h => h.symbol === symbol);
        const quantity = 1; // Fixed quantity for demo. In real app, calculate based on risk management.

        // Determine Exchange Code (KIS format)
        let exchange = 'NASD'; // Default
        if (quote && quote.exchange) {
            if (quote.exchange === 'NYQ' || quote.exchange === 'NYS' || quote.exchange === 'NYSE') {
                exchange = 'NYSE';
            } else if (quote.exchange === 'ASE' || quote.exchange === 'AMS' || quote.exchange === 'AMEX') {
                exchange = 'AMEX';
            }
            // Yahoo often returns 'NMS', 'NGM' for Nasdaq -> Keep 'NASD'
        }

        // BUY Logic
        if (screeningResult.recommendation === 'STRONG_BUY' || screeningResult.recommendation === 'BUY') {
            // Only buy if we don't have it (or want to accumulate) and have enough money
            // For this demo: only buy if we don't have it
            if (!holding) {
                const estimatedCost = currentPrice * quantity;
                if (buyingPower >= estimatedCost) {
                    logger.info(`[SIGNAL] BUY ${symbol} @ ${currentPrice} (Score: ${screeningResult.totalScore}) on ${exchange}`);
                    const orderResult = await kisApi.placeOrder(symbol, 'BUY', quantity, currentPrice, exchange);

                    if (orderResult) {
                        return { action: 'BUY', cost: estimatedCost };
                    } else {
                        logger.error(`[FAILURE] BUY ${symbol} Order Failed`);
                        return null;
                    }
                } else {
                    logger.warn(`[SKIP] BUY ${symbol}: Insufficient Funds (Need $${estimatedCost}, Have $${buyingPower})`);
                }
            }
        }
        // SELL Logic
        else if (screeningResult.recommendation === 'SELL') {
            if (holding && holding.qty > 0) {
                logger.info(`[SIGNAL] SELL ${symbol} @ ${currentPrice} (Score: ${screeningResult.totalScore}) on ${exchange}`);
                const orderResult = await kisApi.placeOrder(symbol, 'SELL', holding.qty, currentPrice, exchange);

                if (orderResult) {
                    return { action: 'SELL', cost: 0 };
                } else {
                    logger.error(`[FAILURE] SELL ${symbol} Order Failed`);
                    return null;
                }
            }
        }

        return null;
    }
}

module.exports = new Trader();
