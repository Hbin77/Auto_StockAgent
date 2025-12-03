/**
 * Market Regime Filter
 * 시장 전체 상태를 판단하여 매매 전략 조절
 * - VIX (공포지수) 기반 시장 심리 판단
 * - SPY (S&P 500 ETF) 추세 기반 시장 방향 판단
 * - 시간대별 전략 조절
 */

const yahooFinance = require('yahoo-finance2').default;
const { SMA } = require('technicalindicators');

class MarketRegimeFilter {
    constructor() {
        this.cache = {
            regime: null,
            lastUpdate: null,
            cacheDuration: 5 * 60 * 1000 // 5분 캐시
        };
    }

    /**
     * 시장 레짐 분석 (캐시 적용)
     */
    async getMarketRegime() {
        // 캐시 확인
        if (this.cache.regime && this.cache.lastUpdate) {
            const elapsed = Date.now() - this.cache.lastUpdate;
            if (elapsed < this.cache.cacheDuration) {
                return this.cache.regime;
            }
        }

        try {
            const regime = await this._analyzeMarketRegime();
            this.cache.regime = regime;
            this.cache.lastUpdate = Date.now();
            return regime;
        } catch (error) {
            console.error(`Market Regime Error: ${error.message}`);
            // 에러 시 기본값 반환 (중립)
            return {
                regime: 'NEUTRAL',
                vix: null,
                spyTrend: 'UNKNOWN',
                tradingSession: this.getTradingSession(),
                allowBuy: false, // FAIL-SAFE: Do not allow buy if data is missing
                allowSell: true,
                positionSizeMultiplier: 0.5, // Reduce size if trading on stale/partial data
                message: 'Market data unavailable, using defaults (Buy Disabled)'
            };
        }
    }

    async _analyzeMarketRegime() {
        // 1. VIX 데이터 가져오기
        const vixData = await this._getVIXData();

        // 2. SPY 추세 분석
        const spyAnalysis = await this._getSPYTrend();

        // 3. 현재 거래 세션 확인
        const tradingSession = this.getTradingSession();

        // 4. 레짐 결정
        return this._determineRegime(vixData, spyAnalysis, tradingSession);
    }

    async _getVIXData() {
        try {
            const quote = await yahooFinance.quote('^VIX');
            return {
                current: quote.regularMarketPrice,
                change: quote.regularMarketChangePercent,
                previousClose: quote.regularMarketPreviousClose
            };
        } catch (error) {
            return { current: 20, change: 0, previousClose: 20 }; // 기본값
        }
    }

    async _getSPYTrend() {
        try {
            // SPY 20일 데이터 가져오기
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            const historical = await yahooFinance.chart('SPY', {
                period1: startDate,
                period2: endDate,
                interval: '1d'
            });

            const closes = historical.quotes.map(q => q.close).filter(c => c != null);

            if (closes.length < 20) {
                return { trend: 'UNKNOWN', ma20: null, currentPrice: null };
            }

            const ma20 = SMA.calculate({ period: 20, values: closes });
            const currentPrice = closes[closes.length - 1];
            const currentMA20 = ma20[ma20.length - 1];

            // 5일 MA도 계산 (단기 추세)
            const ma5 = SMA.calculate({ period: 5, values: closes });
            const currentMA5 = ma5[ma5.length - 1];

            let trend = 'NEUTRAL';
            if (currentPrice > currentMA20 && currentMA5 > currentMA20) {
                trend = 'BULLISH';
            } else if (currentPrice < currentMA20 && currentMA5 < currentMA20) {
                trend = 'BEARISH';
            }

            // 추세 강도 계산 (MA20 대비 거리 %)
            const trendStrength = ((currentPrice - currentMA20) / currentMA20) * 100;

            return {
                trend,
                ma20: currentMA20,
                ma5: currentMA5,
                currentPrice,
                trendStrength
            };
        } catch (error) {
            return { trend: 'UNKNOWN', ma20: null, currentPrice: null, trendStrength: 0 };
        }
    }

    /**
     * 현재 거래 세션 확인 (미국 동부시간 기준)
     */
    getTradingSession() {
        const now = new Date();

        // 미국 동부시간으로 변환
        const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const hour = etTime.getHours();
        const minute = etTime.getMinutes();
        const totalMinutes = hour * 60 + minute;

        // 프리마켓: 4:00 AM - 9:30 AM ET
        // 오프닝: 9:30 AM - 10:30 AM ET (높은 변동성)
        // 코어: 10:30 AM - 3:00 PM ET (안정적)
        // 파워아워: 3:00 PM - 4:00 PM ET (마감 랠리)
        // 애프터마켓: 4:00 PM - 8:00 PM ET

        if (totalMinutes >= 240 && totalMinutes < 570) {
            return { session: 'PREMARKET', volatility: 'HIGH', recommendation: 'AVOID' };
        } else if (totalMinutes >= 570 && totalMinutes < 630) {
            return { session: 'OPENING', volatility: 'VERY_HIGH', recommendation: 'WAIT' };
        } else if (totalMinutes >= 630 && totalMinutes < 900) {
            return { session: 'CORE', volatility: 'NORMAL', recommendation: 'ACTIVE' };
        } else if (totalMinutes >= 900 && totalMinutes < 960) {
            return { session: 'POWER_HOUR', volatility: 'HIGH', recommendation: 'CLOSE_POSITIONS' };
        } else if (totalMinutes >= 960 && totalMinutes < 1200) {
            return { session: 'AFTERMARKET', volatility: 'HIGH', recommendation: 'AVOID' };
        } else {
            return { session: 'CLOSED', volatility: 'NONE', recommendation: 'WAIT' };
        }
    }

    _determineRegime(vixData, spyAnalysis, tradingSession) {
        let regime = 'NEUTRAL';
        let allowBuy = true;
        let allowSell = true;
        let positionSizeMultiplier = 1.0;
        let messages = [];

        // VIX 기반 판단
        if (vixData.current >= 30) {
            regime = 'EXTREME_FEAR';
            allowBuy = false; // 극심한 공포 시 매수 금지
            positionSizeMultiplier = 0.3;
            messages.push(`VIX ${vixData.current}: Extreme fear - NO BUY`);
        } else if (vixData.current >= 25) {
            regime = 'FEAR';
            positionSizeMultiplier = 0.5;
            messages.push(`VIX ${vixData.current}: Fear - Reduce position size`);
        } else if (vixData.current >= 20) {
            regime = 'CAUTIOUS';
            positionSizeMultiplier = 0.75;
            messages.push(`VIX ${vixData.current}: Cautious`);
        } else if (vixData.current < 15) {
            regime = 'GREED';
            positionSizeMultiplier = 1.2; // 낮은 공포 = 적극적
            messages.push(`VIX ${vixData.current}: Low fear - Aggressive`);
        }

        // SPY 추세 기반 조정
        if (spyAnalysis.trend === 'BEARISH') {
            if (regime !== 'EXTREME_FEAR') {
                regime = 'BEARISH';
            }
            allowBuy = false; // 하락장에서는 매수 금지
            positionSizeMultiplier *= 0.5;
            messages.push(`SPY below MA20: Downtrend - NO BUY`);
        } else if (spyAnalysis.trend === 'BULLISH') {
            if (regime === 'NEUTRAL' || regime === 'GREED') {
                regime = 'BULLISH';
            }
            positionSizeMultiplier *= 1.2;
            messages.push(`SPY above MA20: Uptrend - Aggressive`);
        }

        // 거래 세션 기반 조정
        if (tradingSession.session === 'OPENING') {
            allowBuy = false; // 오프닝 30분은 관망
            messages.push('Opening volatility - Wait');
        } else if (tradingSession.session === 'POWER_HOUR') {
            allowBuy = false; // 파워아워는 포지션 정리
            messages.push('Power hour - Close positions only');
        } else if (tradingSession.session === 'CLOSED' || tradingSession.session === 'PREMARKET') {
            allowBuy = false;
            allowSell = false;
            messages.push('Market closed');
        }

        // 포지션 사이즈 제한 (0.2 ~ 2.0)
        positionSizeMultiplier = Math.max(0.2, Math.min(2.0, positionSizeMultiplier));

        return {
            regime,
            vix: vixData.current,
            vixChange: vixData.change,
            spyTrend: spyAnalysis.trend,
            spyTrendStrength: spyAnalysis.trendStrength,
            spyPrice: spyAnalysis.currentPrice,
            spyMA20: spyAnalysis.ma20,
            tradingSession: tradingSession.session,
            sessionRecommendation: tradingSession.recommendation,
            allowBuy,
            allowSell,
            positionSizeMultiplier,
            message: messages.join(' | ')
        };
    }

    /**
     * 특정 종목이 현재 시장 상황에서 거래 가능한지 확인
     */
    async canTrade(symbol, action) {
        const regime = await this.getMarketRegime();

        if (action === 'BUY' && !regime.allowBuy) {
            return {
                allowed: false,
                reason: regime.message,
                regime: regime.regime
            };
        }

        if (action === 'SELL' && !regime.allowSell) {
            return {
                allowed: false,
                reason: regime.message,
                regime: regime.regime
            };
        }

        return {
            allowed: true,
            positionSizeMultiplier: regime.positionSizeMultiplier,
            regime: regime.regime
        };
    }
}

module.exports = new MarketRegimeFilter();