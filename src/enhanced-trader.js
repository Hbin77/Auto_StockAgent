/**
 * Enhanced Trader
 * 수익률 극대화를 위한 모든 전략 통합
 * 
 * 적용된 전략:
 * 1. 트레일링 스탑 (Trailing Stop)
 * 2. 시장 레짐 필터 (Market Regime Filter)
 * 3. 포지션 사이징 (Position Sizing)
 * 4. 변동성 기반 종목 집중
 * 5. 스코어링 가중치 최적화
 * 6. 멀티 타임프레임 분석
 * 7. 시간대별 전략
 */

const config = require('./config');
const dataCollector = require('./data-collector');
const stockTools = require('./stock-tools');
const dayTradingMonitor = require('./daytrading-signal-monitor');
const enhancedScreener = require('./enhanced-multi-factor-screener');
const newsAnalyzer = require('./news-analyzer');
const kisApi = require('./kis-api');
const marketRegimeFilter = require('./market-regime-filter');
const positionManager = require('./position-manager');
const volatilityAnalyzer = require('./volatility-analyzer');
const multiTimeframeAnalyzer = require('./multi-timeframe-analyzer');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'trade.log' }),
        new winston.transports.File({ filename: 'trade-error.log', level: 'error' })
    ]
});

class EnhancedTrader {
    constructor() {
        this.isTrading = false;
        this.tradingStats = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalProfit: 0,
            largestWin: 0,
            largestLoss: 0
        };
    }

    async start() {
        if (this.isTrading) {
            logger.warn('Trading cycle already in progress. Skipping...');
            return;
        }
        this.isTrading = true;

        try {
            logger.info('========================================');
            logger.info('Starting Enhanced Trading Cycle...');
            logger.info('========================================');

            // ============================================
            // 1. 시장 레짐 확인 (Market Regime Filter)
            // ============================================
            const marketRegime = await marketRegimeFilter.getMarketRegime();
            logger.info(`Market Regime: ${marketRegime.regime} | VIX: ${marketRegime.vix} | SPY: ${marketRegime.spyTrend}`);
            logger.info(`Session: ${marketRegime.tradingSession} | Allow Buy: ${marketRegime.allowBuy} | Position Multiplier: ${marketRegime.positionSizeMultiplier}`);

            if (!marketRegime.allowBuy && !marketRegime.allowSell) {
                logger.info('Market closed or conditions not favorable. Skipping cycle.');
                return;
            }

            // ============================================
            // 2. 계좌 정보 조회
            // ============================================
            const accountData = await kisApi.getBalance();
            const buyingPower = accountData.buyingPower;
            const holdings = accountData.holdings;
            const totalCapital = buyingPower + holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);

            logger.info(`Balance: $${buyingPower.toFixed(2)} | Holdings: ${holdings.length} | Total Capital: $${totalCapital.toFixed(2)}`);

            // ============================================
            // 3. 기존 포지션 관리 (트레일링 스탑 체크)
            // ============================================
            await this.manageExistingPositions(holdings, marketRegime);

            // ============================================
            // 4. 신규 매수 가능 여부 확인
            // ============================================
            if (!marketRegime.allowBuy) {
                logger.info('Buy not allowed in current market regime. Skipping new positions.');
                return;
            }

            if (buyingPower < 10) {
                logger.info('Insufficient buying power for new positions.');
                return;
            }

            // ============================================
            // 5. 종목 선별 (변동성 기반 필터링)
            // ============================================
            const allTickers = this._getAllTickers();
            logger.info(`Screening ${allTickers.length} tickers...`);

            // 5-1. 변동성 기반 사전 필터링 (상위 50개)
            const volatileStocks = await this.filterByVolatility(allTickers, buyingPower);
            logger.info(`Found ${volatileStocks.length} high-volatility affordable stocks`);

            if (volatileStocks.length === 0) {
                logger.info('No suitable stocks found after volatility filtering.');
                return;
            }

            // ============================================
            // 6. 상세 분석 및 매수 실행
            // ============================================
            await this.analyzeAndTrade(volatileStocks, buyingPower, holdings, totalCapital, marketRegime);

            logger.info('========================================');
            logger.info('Enhanced Trading Cycle Completed');
            logger.info('========================================');

        } catch (error) {
            logger.error(`Trading Cycle Error: ${error.message}`);
            logger.error(error.stack);
        } finally {
            this.isTrading = false;
        }
    }

    /**
     * 기존 포지션 관리 (트레일링 스탑, 익절, 손절)
     */
    async manageExistingPositions(holdings, marketRegime) {
        if (holdings.length === 0) return;

        logger.info(`Managing ${holdings.length} existing positions...`);

        for (const holding of holdings) {
            try {
                const quote = await dataCollector.fetchQuote(holding.symbol);
                if (!quote) continue;

                const currentPrice = quote.regularMarketPrice;

                // 포지션 매니저에 등록 (없으면)
                if (!positionManager.hasPosition(holding.symbol)) {
                    positionManager.addPosition(
                        holding.symbol,
                        holding.avgPrice || holding.buyPrice,
                        holding.qty,
                        50 // 기본 점수
                    );
                }

                // 트레일링 스탑 체크
                const positionStatus = positionManager.updatePrice(holding.symbol, currentPrice);

                if (positionStatus.action === 'STOP_LOSS' ||
                    positionStatus.action === 'TRAILING_STOP') {
                    logger.warn(`[${positionStatus.action}] ${holding.symbol}: ${positionStatus.reason}`);
                    await this.executeSell(holding.symbol, holding.qty, currentPrice, quote, positionStatus.action);
                }
                else if (positionStatus.action.startsWith('TAKE_PROFIT')) {
                    const sellQty = Math.ceil(holding.qty * (positionStatus.sellPercent / 100));
                    if (sellQty > 0) {
                        logger.info(`[${positionStatus.action}] ${holding.symbol}: Selling ${sellQty} shares (${positionStatus.sellPercent}%)`);
                        await this.executeSell(holding.symbol, sellQty, currentPrice, quote, positionStatus.action);
                    }
                }
                else {
                    // 스코어 기반 매도 체크
                    const sellCheck = await this.checkSellSignal(holding, currentPrice);
                    if (sellCheck.shouldSell) {
                        logger.info(`[SIGNAL_SELL] ${holding.symbol}: ${sellCheck.reason}`);
                        await this.executeSell(holding.symbol, holding.qty, currentPrice, quote, 'SIGNAL_SELL');
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                logger.error(`Error managing ${holding.symbol}: ${error.message}`);
            }
        }
    }

    /**
     * 변동성 기반 종목 필터링
     */
    async filterByVolatility(tickers, buyingPower) {
        const results = [];
        const batchSize = 20;

        for (let i = 0; i < tickers.length; i += batchSize) {
            const batch = tickers.slice(i, i + batchSize);

            const batchResults = await Promise.all(
                batch.map(async (symbol) => {
                    try {
                        const quote = await dataCollector.fetchQuote(symbol);
                        if (!quote || !quote.regularMarketPrice) return null;

                        const price = quote.regularMarketPrice;

                        // 가격 필터 (구매 가능)
                        if (price > buyingPower) return null;
                        if (price < 5) return null; // 페니 스탁 제외

                        // 변동성 분석
                        const volatility = await volatilityAnalyzer.analyze(symbol);

                        // 최소 변동성 요구 (ATR 1.5% 이상)
                        if (volatility.atrPercent < 1.5) return null;

                        return {
                            symbol,
                            price,
                            volatility,
                            quote
                        };
                    } catch (error) {
                        return null;
                    }
                })
            );

            results.push(...batchResults.filter(r => r !== null));

            // 상위 50개만 유지
            if (results.length >= 50) break;

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 변동성 점수로 정렬
        return results
            .sort((a, b) => b.volatility.score - a.volatility.score)
            .slice(0, 50);
    }

    /**
     * 종목 분석 및 매수 실행
     */
    async analyzeAndTrade(candidates, buyingPower, holdings, totalCapital, marketRegime) {
        let remainingBuyingPower = buyingPower;
        let tradesExecuted = 0;
        const maxTradesPerCycle = 3; // 사이클당 최대 3개 매수

        for (const candidate of candidates) {
            if (tradesExecuted >= maxTradesPerCycle) {
                logger.info(`Max trades per cycle (${maxTradesPerCycle}) reached.`);
                break;
            }

            if (remainingBuyingPower < candidate.price) continue;

            // 이미 보유 중인지 확인
            const alreadyHeld = holdings.some(h => h.symbol === candidate.symbol);
            if (alreadyHeld) continue;

            try {
                const analysis = await this.analyzeStock(candidate);

                if (!analysis) continue;

                logger.info(`${candidate.symbol}: Score ${analysis.score} (${analysis.recommendation}) | Confidence: ${analysis.confidence}% | Volatility: ${candidate.volatility.atrPercent.toFixed(2)}%`);

                // 매수 조건 확인
                if (analysis.recommendation === 'STRONG_BUY' || analysis.recommendation === 'BUY') {
                    // 포지션 사이징
                    const positionSize = positionManager.calculatePositionSize(
                        totalCapital,
                        candidate.price,
                        analysis.score,
                        marketRegime.positionSizeMultiplier,
                        candidate.volatility.atr
                    );

                    // 구매 가능 수량 조정
                    const affordableQty = Math.floor(remainingBuyingPower / candidate.price);
                    const finalQty = Math.min(positionSize.quantity, affordableQty);

                    if (finalQty <= 0) continue;

                    // 포지션 추가 가능 여부 확인
                    const canAdd = positionManager.canAddPosition(
                        holdings,
                        totalCapital,
                        finalQty * candidate.price
                    );

                    if (!canAdd.allowed) {
                        logger.warn(`[SKIP] ${candidate.symbol}: ${canAdd.reason}`);
                        continue;
                    }

                    // 매수 실행
                    const orderResult = await this.executeBuy(
                        candidate.symbol,
                        finalQty,
                        candidate.price,
                        candidate.quote,
                        analysis
                    );

                    if (orderResult) {
                        remainingBuyingPower -= finalQty * candidate.price;
                        tradesExecuted++;

                        // 포지션 매니저에 등록
                        positionManager.addPosition(
                            candidate.symbol,
                            candidate.price,
                            finalQty,
                            analysis.score
                        );
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 300));

            } catch (error) {
                logger.error(`Error analyzing ${candidate.symbol}: ${error.message}`);
            }
        }

        logger.info(`Executed ${tradesExecuted} trades in this cycle.`);
    }

    /**
     * 종목 상세 분석
     */
    async analyzeStock(candidate) {
        try {
            // 과거 데이터 조회
            const historicalData = await dataCollector.fetchMarketData(candidate.symbol, '5m', 5);
            if (historicalData.length < 50) return null;

            // 기술적 분석
            const dayTradingAnalysis = dayTradingMonitor.analyze(historicalData);

            // 뉴스 분석 (점수가 양수일 때만)
            let newsAnalysis = null;
            if (dayTradingAnalysis.score > 0) {
                newsAnalysis = await newsAnalyzer.analyzeNews(candidate.symbol);
            }

            // 멀티 타임프레임 분석
            const mtfAnalysis = await multiTimeframeAnalyzer.analyze(candidate.symbol);

            // 펀더멘털 데이터
            const fundamentalData = {
                peRatio: candidate.quote.trailingPE,
                pegRatio: candidate.quote.pegRatio,
                marketCap: candidate.quote.marketCap
            };

            // 변동성 데이터
            const volatilityData = {
                atr: candidate.volatility.atr,
                atrPercent: candidate.volatility.atrPercent,
                volumeSpike: candidate.volatility.volumeSpike
            };

            // 멀티 타임프레임 데이터
            const multiTimeframeData = {
                hourlyTrend: mtfAnalysis.hourlyTrend,
                dailyTrend: mtfAnalysis.dailyTrend
            };

            // 향상된 스코어링
            const result = enhancedScreener.calculateScore(
                dayTradingAnalysis,
                fundamentalData,
                newsAnalysis,
                volatilityData,
                multiTimeframeData
            );

            return {
                score: result.totalScore,
                recommendation: result.recommendation,
                confidence: result.confidence,
                breakdown: result.breakdown,
                mtfAlignment: mtfAnalysis.alignment,
                signals: dayTradingAnalysis.signals
            };

        } catch (error) {
            logger.error(`Analysis error for ${candidate.symbol}: ${error.message}`);
            return null;
        }
    }

    /**
     * 매도 신호 확인
     */
    async checkSellSignal(holding, currentPrice) {
        try {
            const historicalData = await dataCollector.fetchMarketData(holding.symbol, '5m', 5);
            if (historicalData.length < 50) {
                return { shouldSell: false };
            }

            const analysis = dayTradingMonitor.analyze(historicalData);
            const quote = await dataCollector.fetchQuote(holding.symbol);

            const fundamentalData = {
                peRatio: quote?.trailingPE,
                pegRatio: quote?.pegRatio
            };

            const result = enhancedScreener.calculateScore(analysis, fundamentalData, null);

            // SELL 또는 STRONG_SELL 신호
            if (result.recommendation === 'STRONG_SELL') {
                return {
                    shouldSell: true,
                    reason: `Strong sell signal (Score: ${result.totalScore})`
                };
            }

            if (result.recommendation === 'SELL' && result.confidence >= 70) {
                return {
                    shouldSell: true,
                    reason: `Sell signal with high confidence (Score: ${result.totalScore}, Confidence: ${result.confidence}%)`
                };
            }

            return { shouldSell: false };

        } catch (error) {
            return { shouldSell: false };
        }
    }

    /**
     * 매수 실행
     */
    async executeBuy(symbol, quantity, price, quote, analysis) {
        try {
            let exchange = 'NASD';
            if (quote && quote.exchange) {
                if (['NYQ', 'NYS', 'NYSE'].includes(quote.exchange)) {
                    exchange = 'NYSE';
                } else if (['ASE', 'AMS', 'AMEX'].includes(quote.exchange)) {
                    exchange = 'AMEX';
                }
            }

            logger.info(`[BUY] ${symbol} x${quantity} @ $${price.toFixed(2)} (Score: ${analysis.score}, Confidence: ${analysis.confidence}%)`);

            const orderResult = await kisApi.placeOrder(symbol, 'BUY', quantity, price, exchange);

            if (orderResult) {
                this.tradingStats.totalTrades++;
                return true;
            }

            return false;

        } catch (error) {
            logger.error(`Buy order failed for ${symbol}: ${error.message}`);
            return false;
        }
    }

    /**
     * 매도 실행
     */
    async executeSell(symbol, quantity, price, quote, reason) {
        try {
            let exchange = 'NASD';
            if (quote && quote.exchange) {
                if (['NYQ', 'NYS', 'NYSE'].includes(quote.exchange)) {
                    exchange = 'NYSE';
                } else if (['ASE', 'AMS', 'AMEX'].includes(quote.exchange)) {
                    exchange = 'AMEX';
                }
            }

            logger.info(`[SELL] ${symbol} x${quantity} @ $${price.toFixed(2)} (Reason: ${reason})`);

            const orderResult = await kisApi.placeOrder(symbol, 'SELL', quantity, price, exchange);

            if (orderResult) {
                this.tradingStats.totalTrades++;
                positionManager.removePosition(symbol);
                return true;
            }

            return false;

        } catch (error) {
            logger.error(`Sell order failed for ${symbol}: ${error.message}`);
            return false;
        }
    }

    /**
     * 모든 티커 가져오기
     */
    _getAllTickers() {
        const sp500 = config.tickers.sp500 || [];
        const nasdaq100 = config.tickers.nasdaq100 || [];
        const budgetGrowth = config.tickers.budgetGrowth || [];

        // 중복 제거
        const allTickers = [...new Set([...sp500, ...nasdaq100, ...budgetGrowth])];
        return allTickers;
    }

    /**
     * 트레이딩 통계 조회
     */
    getStats() {
        const winRate = this.tradingStats.totalTrades > 0
            ? (this.tradingStats.winningTrades / this.tradingStats.totalTrades * 100).toFixed(2)
            : 0;

        return {
            ...this.tradingStats,
            winRate: `${winRate}%`
        };
    }
}

module.exports = new EnhancedTrader();