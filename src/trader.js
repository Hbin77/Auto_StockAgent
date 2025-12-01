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
    constructor() {
        this.isTrading = false;
    }

    async start() {
        if (this.isTrading) {
            logger.warn('Trading cycle already in progress. Skipping...');
            return;
        }
        this.isTrading = true;

        try {
            let restartRequired = false;

            do {
                restartRequired = false;
                logger.info('Starting Trading Cycle...');

                // 0. Get Account Balance & Holdings
                let accountData = await kisApi.getBalance();
                let buyingPower = accountData.buyingPower;
                let holdings = accountData.holdings;

                logger.info(`Current Balance (USD): $${buyingPower}`);
                logger.info(`Current Holdings: ${holdings.map(h => `${h.symbol}(${h.qty})`).join(', ') || 'None'}`);

                // 0.5 Check for Unfilled Orders (Auto Cancel > 5 mins)
                try {
                    const unfilledOrders = await kisApi.getUnfilledOrders();
                    if (unfilledOrders.length > 0) {
                        logger.info(`Found ${unfilledOrders.length} unfilled orders. Checking age...`);
                        const now = new Date();
                        const currentHHMMSS = Number(now.toTimeString().split(' ')[0].replace(/:/g, '')); // HHMMSS as number

                        for (const order of unfilledOrders) {
                            // Simple time check: If order time is significantly different from now
                            // Note: This simple number subtraction works for same-hour or near-hour, but crossing hour boundary needs care.
                            // Better: Parse to Date object.

                            // Parse Order Time (HHMMSS)
                            const orderTimeStr = order.orderTimeTime; // "180500"
                            if (orderTimeStr && orderTimeStr.length === 6) {
                                const orderDate = new Date();
                                orderDate.setHours(Number(orderTimeStr.substring(0, 2)));
                                orderDate.setMinutes(Number(orderTimeStr.substring(2, 4)));
                                orderDate.setSeconds(Number(orderTimeStr.substring(4, 6)));

                                const diffMs = now - orderDate;
                                const diffMins = diffMs / 1000 / 60;

                                if (diffMins > 5) {
                                    logger.info(`[AUTO CANCEL] Order ${order.orderNo} for ${order.symbol} is ${diffMins.toFixed(1)} mins old. Cancelling...`);
                                    await kisApi.cancelOrder(order.orderNo, order.symbol, 0); // Cancel all
                                    restartRequired = true; // Restart cycle after cancel
                                }
                            }
                        }
                    }
                } catch (err) {
                    logger.error(`Failed to check unfilled orders: ${err.message}`);
                }

                // 1. Get Tickers
                const allTickers = [...new Set([
                    ...config.tickers.nasdaq100,
                    ...config.tickers.sp500,
                    ...config.tickers.budgetGrowth // Added for Max Yield Strategy
                ])];
                logger.info(`Total Tickers: ${allTickers.length}`);

                // 2. Pre-filter: Check Budget
                // If buyingPower is very low (e.g. < $10), we can't buy anything meaningful.
                // But we might want to SELL existing holdings.
                // So we split the list: Holdings (always check) + Affordable Candidates.

                const holdingSymbols = holdings.map(h => h.symbol);
                let affordableTickers = [];

                // Optimization: If balance is too low to buy meaningful stocks (e.g. < $50), 
                // and we have holdings, ONLY monitor holdings to save API calls and time.
                // BUT if we just sold something, buyingPower might have increased, so we need to re-check.
                const MIN_BUY_BALANCE = 50;

                if (buyingPower < MIN_BUY_BALANCE && holdingSymbols.length > 0) {
                    logger.info(`Low Balance ($${buyingPower} < $${MIN_BUY_BALANCE}). Monitoring ${holdingSymbols.length} holdings only.`);
                    affordableTickers = [...holdingSymbols];
                } else {
                    // Fetch quotes for ALL tickers to filter by price
                    // Batching requests to avoid URL length limits if list is huge (500 is fine usually, but let's be safe)
                    logger.info('Fetching real-time prices for budget filtering...');

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
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }

                // Remove duplicates just in case
                affordableTickers = [...new Set(affordableTickers)];
                logger.info(`Affordable/Held Tickers to Analyze: ${affordableTickers.length} / ${allTickers.length}`);

                // 3. Iterate and Analyze (Only Affordable/Held)
                for (const symbol of affordableTickers) {
                    // Update buyingPower after each trade decision to avoid overdraft in same cycle
                    const tradeResult = await this.processSymbol(symbol, buyingPower, holdings);

                    if (tradeResult) {
                        if (tradeResult.action === 'BUY') {
                            buyingPower -= tradeResult.cost;
                            logger.info(`[BUY EXECUTED] Balance decreased. Restarting cycle to re-evaluate budget...`);
                            restartRequired = true;
                            break; // Break ticker loop to restart
                        } else if (tradeResult.action === 'SELL') {
                            logger.info(`[SELL EXECUTED] Balance increased. Restarting cycle to re-evaluate budget...`);
                            restartRequired = true;
                            break; // Break ticker loop to restart
                        }
                    }

                    // Throttling: Wait 300ms between requests to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                if (restartRequired) {
                    logger.info('Restarting Trading Cycle due to executed trade...');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait a bit for API to update
                }

            } while (restartRequired);

            logger.info('Trading Cycle Completed.');
        } catch (error) {
            logger.error(`Trading Cycle Error: ${error.message}`);
        } finally {
            this.isTrading = false;
        }
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
                // Cautious Sell Logic:
                // 1. Stop Loss: If loss is > 3%, SELL immediately to prevent disaster.
                // 2. Take Profit: If profitable (> 0.5% to cover fees), SELL to lock in gains.
                // 3. Hold on Small Loss/Breakeven: If profit is between -3% and +0.5%, HOLD.

                const STOP_LOSS_LIMIT = -3.0; // -3%
                const MIN_NET_PROFIT = 0.5; // 0.25% Sell Fee + Buffer

                // If it's a "Take Profit" signal (SELL recommendation), make sure we actually make money after fees.
                // If profit is less than MIN_NET_PROFIT (e.g. 0.1%), we might lose money on fees.
                // UNLESS it's a Stop Loss situation (profit < -3%).

                if (holding.profitRate > STOP_LOSS_LIMIT && holding.profitRate < MIN_NET_PROFIT) {
                    logger.info(`[HOLD] Sell Signal for ${symbol} but Profit (${holding.profitRate}%) is too low to cover fees (> ${MIN_NET_PROFIT}%). Waiting...`);
                    return null;
                }

                logger.info(`[SIGNAL] SELL ${symbol} @ ${currentPrice} (Score: ${screeningResult.totalScore}, Profit: ${holding.profitRate}%) on ${exchange}`);
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
