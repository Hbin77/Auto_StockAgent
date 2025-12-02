/**
 * Multi-Timeframe Analyzer
 * 여러 시간대의 추세를 분석하여 신호 신뢰도 향상
 */

const yahooFinance = require('yahoo-finance2').default;
const { SMA, RSI, MACD } = require('technicalindicators');

class MultiTimeframeAnalyzer {
    constructor() {
        this.cache = {};
        this.cacheDuration = 5 * 60 * 1000; // 5분 캐시
    }

    /**
     * 멀티 타임프레임 분석 수행
     * @param {string} symbol - 종목 심볼
     */
    async analyze(symbol) {
        // 캐시 확인
        const cached = this.cache[symbol];
        if (cached && (Date.now() - cached.timestamp < this.cacheDuration)) {
            return cached.data;
        }

        try {
            // 여러 타임프레임 데이터 가져오기
            const [hourlyAnalysis, dailyAnalysis] = await Promise.all([
                this._analyzeTimeframe(symbol, '1h', 50),
                this._analyzeTimeframe(symbol, '1d', 30)
            ]);

            const result = {
                symbol,
                hourlyTrend: hourlyAnalysis.trend,
                hourlyScore: hourlyAnalysis.score,
                hourlyIndicators: hourlyAnalysis.indicators,
                dailyTrend: dailyAnalysis.trend,
                dailyScore: dailyAnalysis.score,
                dailyIndicators: dailyAnalysis.indicators,
                alignment: this._calculateAlignment(hourlyAnalysis, dailyAnalysis),
                recommendation: this._getRecommendation(hourlyAnalysis, dailyAnalysis)
            };

            // 캐시 저장
            this.cache[symbol] = {
                data: result,
                timestamp: Date.now()
            };

            return result;

        } catch (error) {
            // console.error(`MTF Analysis Error for ${symbol}: ${error.message}`);
            return {
                symbol,
                hourlyTrend: 'UNKNOWN',
                dailyTrend: 'UNKNOWN',
                alignment: 'UNKNOWN',
                recommendation: 'NEUTRAL'
            };
        }
    }

    async _analyzeTimeframe(symbol, interval, period) {
        try {
            const endDate = new Date();
            const startDate = new Date();

            // 기간 설정
            if (interval === '1h') {
                startDate.setDate(startDate.getDate() - 7); // 7일
            } else if (interval === '1d') {
                startDate.setDate(startDate.getDate() - 60); // 60일
            }

            const historical = await yahooFinance.chart(symbol, {
                period1: startDate,
                period2: endDate,
                interval: interval
            });

            const quotes = historical.quotes.filter(q => q.close != null);
            if (quotes.length < 20) {
                return { trend: 'UNKNOWN', score: 0, indicators: {} };
            }

            const closes = quotes.map(q => q.close);

            // 지표 계산
            const ma10 = SMA.calculate({ period: 10, values: closes });
            const ma20 = SMA.calculate({ period: 20, values: closes });
            const rsi = RSI.calculate({ period: 14, values: closes });
            const macd = MACD.calculate({
                values: closes,
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9,
                SimpleMAOscillator: false,
                SimpleMASignal: false
            });

            const currentPrice = closes[closes.length - 1];
            const currentMA10 = ma10[ma10.length - 1];
            const currentMA20 = ma20[ma20.length - 1];
            const currentRSI = rsi[rsi.length - 1];
            const currentMACD = macd[macd.length - 1];

            // 추세 판단
            let trend = 'NEUTRAL';
            let score = 0;

            // MA 기반 추세
            if (currentPrice > currentMA10 && currentMA10 > currentMA20) {
                trend = 'UP';
                score += 30;
            } else if (currentPrice < currentMA10 && currentMA10 < currentMA20) {
                trend = 'DOWN';
                score -= 30;
            }

            // MACD 기반
            if (currentMACD && currentMACD.histogram > 0) {
                score += 20;
                if (trend === 'NEUTRAL') trend = 'UP';
            } else if (currentMACD && currentMACD.histogram < 0) {
                score -= 20;
                if (trend === 'NEUTRAL') trend = 'DOWN';
            }

            // RSI 기반
            if (currentRSI > 50) {
                score += 10;
            } else if (currentRSI < 50) {
                score -= 10;
            }

            return {
                trend,
                score,
                indicators: {
                    price: currentPrice,
                    ma10: currentMA10,
                    ma20: currentMA20,
                    rsi: currentRSI,
                    macd: currentMACD
                }
            };

        } catch (error) {
            return { trend: 'UNKNOWN', score: 0, indicators: {} };
        }
    }

    _calculateAlignment(hourly, daily) {
        if (hourly.trend === 'UNKNOWN' || daily.trend === 'UNKNOWN') {
            return 'UNKNOWN';
        }

        if (hourly.trend === daily.trend) {
            return 'ALIGNED'; // 모든 타임프레임 일치
        } else if (hourly.trend === 'NEUTRAL' || daily.trend === 'NEUTRAL') {
            return 'PARTIAL'; // 부분 일치
        } else {
            return 'DIVERGENT'; // 불일치 (주의 필요)
        }
    }

    _getRecommendation(hourly, daily) {
        const alignment = this._calculateAlignment(hourly, daily);

        if (alignment === 'ALIGNED') {
            if (hourly.trend === 'UP') {
                return 'STRONG_BUY'; // 모든 타임프레임 상승
            } else if (hourly.trend === 'DOWN') {
                return 'STRONG_SELL'; // 모든 타임프레임 하락
            }
        }

        if (alignment === 'PARTIAL') {
            if (daily.trend === 'UP') {
                return 'BUY_ON_DIP'; // 일봉 상승, 시간봉 눌림 = 매수 기회
            } else if (daily.trend === 'DOWN') {
                return 'SELL_ON_RALLY'; // 일봉 하락, 시간봉 반등 = 매도 기회
            }
        }

        if (alignment === 'DIVERGENT') {
            return 'CAUTION'; // 타임프레임 불일치 = 주의
        }

        return 'NEUTRAL';
    }

    /**
     * 종목 필터링 (정배열 종목만)
     */
    async filterAlignedStocks(symbols) {
        const results = [];

        for (const symbol of symbols) {
            const analysis = await this.analyze(symbol);
            if (analysis.alignment === 'ALIGNED' && analysis.hourlyTrend === 'UP') {
                results.push({
                    symbol,
                    ...analysis
                });
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return results;
    }
}

module.exports = new MultiTimeframeAnalyzer();