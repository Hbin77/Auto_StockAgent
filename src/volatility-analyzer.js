/**
 * Volatility Analyzer
 * ATR, 거래량 스파이크, 변동성 기반 종목 선별
 */

const yahooFinance = require('yahoo-finance2').default;
const { ATR, SMA } = require('technicalindicators');

class VolatilityAnalyzer {
    constructor() {
        this.cache = {};
        this.cacheDuration = 2 * 60 * 1000; // 2분 캐시

        // 변동성 기준
        this.thresholds = {
            highVolatility: 3.0,      // ATR 3% 이상 = 높은 변동성
            mediumVolatility: 2.0,    // ATR 2% 이상 = 중간 변동성
            lowVolatility: 1.0,       // ATR 1% 이하 = 낮은 변동성
            volumeSpike: 2.0,         // 평균 대비 2배 = 거래량 스파이크
            extremeVolumeSpike: 5.0   // 평균 대비 5배 = 극심한 스파이크
        };
    }

    /**
     * 종목 변동성 분석
     */
    async analyze(symbol) {
        // 캐시 확인
        const cached = this.cache[symbol];
        if (cached && (Date.now() - cached.timestamp < this.cacheDuration)) {
            return cached.data;
        }

        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);

            const historical = await yahooFinance.chart(symbol, {
                period1: startDate,
                period2: endDate,
                interval: '1d'
            });

            const quotes = historical.quotes.filter(q =>
                q.high != null && q.low != null && q.close != null && q.volume != null
            );

            if (quotes.length < 14) {
                return this._getDefaultResult(symbol);
            }

            const highs = quotes.map(q => q.high);
            const lows = quotes.map(q => q.low);
            const closes = quotes.map(q => q.close);
            const volumes = quotes.map(q => q.volume);

            // ATR 계산
            const atr = ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14
            });
            const currentATR = atr[atr.length - 1];
            const currentPrice = closes[closes.length - 1];
            const atrPercent = (currentATR / currentPrice) * 100;

            // 거래량 분석
            const avgVolume20 = SMA.calculate({ period: 20, values: volumes });
            const currentVolume = volumes[volumes.length - 1];
            const avgVol = avgVolume20[avgVolume20.length - 1] || currentVolume;
            const volumeRatio = currentVolume / avgVol;

            // 일중 변동성 (오늘의 High-Low 범위)
            const todayRange = (highs[highs.length - 1] - lows[lows.length - 1]) / closes[closes.length - 1] * 100;

            // 최근 5일 변동성 추세
            const recentATRs = atr.slice(-5);
            const atrTrend = recentATRs.length >= 2
                ? (recentATRs[recentATRs.length - 1] - recentATRs[0]) / recentATRs[0] * 100
                : 0;

            // 변동성 레벨 결정
            let volatilityLevel = 'LOW';
            if (atrPercent >= this.thresholds.highVolatility) {
                volatilityLevel = 'HIGH';
            } else if (atrPercent >= this.thresholds.mediumVolatility) {
                volatilityLevel = 'MEDIUM';
            }

            // 거래량 스파이크 여부
            let volumeSignal = 'NORMAL';
            if (volumeRatio >= this.thresholds.extremeVolumeSpike) {
                volumeSignal = 'EXTREME_SPIKE';
            } else if (volumeRatio >= this.thresholds.volumeSpike) {
                volumeSignal = 'SPIKE';
            }

            const result = {
                symbol,
                atr: currentATR,
                atrPercent,
                volatilityLevel,
                currentVolume,
                avgVolume: avgVol,
                volumeRatio,
                volumeSpike: volumeRatio,
                volumeSignal,
                todayRange,
                atrTrend,
                currentPrice,
                score: this._calculateVolatilityScore(atrPercent, volumeRatio, atrTrend)
            };

            // 캐시 저장
            this.cache[symbol] = {
                data: result,
                timestamp: Date.now()
            };

            return result;

        } catch (error) {
            // console.error(`Volatility Analysis Error for ${symbol}: ${error.message}`);
            return this._getDefaultResult(symbol);
        }
    }

    _getDefaultResult(symbol) {
        return {
            symbol,
            atr: 0,
            atrPercent: 0,
            volatilityLevel: 'UNKNOWN',
            currentVolume: 0,
            avgVolume: 0,
            volumeRatio: 1,
            volumeSpike: 1,
            volumeSignal: 'NORMAL',
            todayRange: 0,
            atrTrend: 0,
            score: 0
        };
    }

    _calculateVolatilityScore(atrPercent, volumeRatio, atrTrend) {
        let score = 0;

        // ATR 기반 점수 (데이트레이딩에는 높은 변동성이 좋음)
        if (atrPercent >= 4) {
            score += 30;
        } else if (atrPercent >= 3) {
            score += 25;
        } else if (atrPercent >= 2) {
            score += 15;
        } else if (atrPercent >= 1) {
            score += 5;
        }

        // 거래량 스파이크 점수
        if (volumeRatio >= 5) {
            score += 25; // 극심한 스파이크 = 큰 움직임 예상
        } else if (volumeRatio >= 3) {
            score += 20;
        } else if (volumeRatio >= 2) {
            score += 10;
        }

        // 변동성 증가 추세 보너스
        if (atrTrend > 20) {
            score += 10; // 변동성 증가 중
        } else if (atrTrend < -20) {
            score -= 5; // 변동성 감소 중
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * 고변동성 종목 필터링
     * @param {Array} symbols - 종목 리스트
     * @param {number} minATRPercent - 최소 ATR 퍼센트
     */
    async filterHighVolatilityStocks(symbols, minATRPercent = 2.0) {
        const results = [];

        for (const symbol of symbols) {
            const analysis = await this.analyze(symbol);

            if (analysis.atrPercent >= minATRPercent) {
                results.push(analysis);
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // 점수순 정렬
        return results.sort((a, b) => b.score - a.score);
    }

    /**
     * 거래량 스파이크 종목 찾기
     */
    async findVolumeSpikeStocks(symbols, minSpikeRatio = 2.0) {
        const results = [];

        for (const symbol of symbols) {
            const analysis = await this.analyze(symbol);

            if (analysis.volumeRatio >= minSpikeRatio) {
                results.push(analysis);
            }

            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return results.sort((a, b) => b.volumeRatio - a.volumeRatio);
    }

    /**
     * 변동성 + 거래량 복합 필터
     * 데이트레이딩에 최적인 종목 선별
     */
    async findOptimalDayTradingStocks(symbols) {
        const results = [];

        for (const symbol of symbols) {
            const analysis = await this.analyze(symbol);

            // 조건: ATR 2% 이상 AND (거래량 스파이크 OR 변동성 증가)
            if (analysis.atrPercent >= 2.0 &&
                (analysis.volumeRatio >= 1.5 || analysis.atrTrend > 0)) {
                results.push(analysis);
            }

            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return results.sort((a, b) => b.score - a.score);
    }
}

module.exports = new VolatilityAnalyzer();