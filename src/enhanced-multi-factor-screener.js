/**
 * Enhanced Multi-Factor Screener
 * 최적화된 가중치 및 변동성 기반 점수 계산
 */

class EnhancedMultiFactorScreener {
    constructor() {
        // 최적화된 가중치 설정
        this.weights = {
            technical: 25,      // 기술적 분석 (기존 40 → 25로 감소)
            momentum: 40,       // 모멘텀 (기존 30 → 40으로 증가) - 데이트레이딩에 핵심
            fundamental: 10,    // 펀더멘털 (기존 20 → 10으로 감소) - 단타에 덜 중요
            sentiment: 15,      // 뉴스 감성 (기존 10 → 15로 증가)
            volatility: 10      // 변동성 보너스 (신규)
        };

        // 매수/매도 임계값
        this.thresholds = {
            strongBuy: 75,      // 기존 80 → 75 (더 많은 기회 포착)
            buy: 60,            // 유지
            sell: 25,           // 기존 30 → 25 (조기 손절)
            strongSell: 10      // 신규 - 강한 매도 신호
        };
    }

    /**
     * 종합 점수 계산
     * @param {Object} technicalData - DayTradingMonitor 결과
     * @param {Object} fundamentalData - 펀더멘털 데이터
     * @param {Object} newsData - NewsAnalyzer 결과
     * @param {Object} volatilityData - 변동성 데이터 (선택)
     * @param {Object} multiTimeframeData - 멀티 타임프레임 데이터 (선택)
     */
    calculateScore(technicalData, fundamentalData, newsData, volatilityData = null, multiTimeframeData = null) {
        let technicalScore = 0;
        let momentumScore = 0;
        let fundamentalScore = 0;
        let sentimentScore = 0;
        let volatilityScore = 0;

        // ============================================
        // 1. Technical Score (최대 25점)
        // ============================================
        if (technicalData) {
            // MACD 분석 (최대 10점)
            if (technicalData.signals.includes('MACD_BULLISH')) {
                technicalScore += 10;
            } else if (technicalData.signals.includes('MACD_REVERSAL')) {
                technicalScore += 5;
            } else if (technicalData.signals.includes('MACD_BEARISH')) {
                technicalScore -= 10;
            }

            // 볼린저 밴드 (최대 8점)
            if (technicalData.signals.includes('BB_OVERSOLD')) {
                technicalScore += 8; // 반등 기회
            } else if (technicalData.signals.includes('BB_OVERBOUGHT')) {
                technicalScore -= 8;
            }

            // RSI (최대 7점)
            if (technicalData.signals.includes('RSI_OVERSOLD')) {
                technicalScore += 7;
            } else if (technicalData.signals.includes('RSI_OVERBOUGHT')) {
                technicalScore -= 7;
            }
        }
        technicalScore = Math.max(-25, Math.min(25, technicalScore));

        // ============================================
        // 2. Momentum Score (최대 40점) - 가장 중요!
        // ============================================
        if (technicalData) {
            // MA 정배열 (최대 20점)
            if (technicalData.signals.includes('MA_UPTREND')) {
                momentumScore += 20;
            } else if (technicalData.indicators) {
                // 부분 정배열 체크
                const { ma5, ma10, ma20 } = technicalData.indicators;
                if (ma5 > ma10) momentumScore += 8;
                if (ma10 > ma20) momentumScore += 7;
            }

            // MACD 히스토그램 방향 (최대 10점)
            if (technicalData.indicators && technicalData.indicators.macd) {
                const histogram = technicalData.indicators.macd.histogram;
                if (histogram > 0) {
                    momentumScore += 10;
                } else if (histogram < 0) {
                    momentumScore -= 10;
                }
            }

            // 가격 위치 (MA20 대비)
            if (technicalData.indicators && technicalData.indicators.ma20) {
                const priceAboveMA20 = technicalData.currentPrice > technicalData.indicators.ma20;
                if (priceAboveMA20) {
                    momentumScore += 10;
                } else {
                    momentumScore -= 10;
                }
            }
        }

        // 멀티 타임프레임 보너스 (최대 10점 추가)
        if (multiTimeframeData) {
            if (multiTimeframeData.hourlyTrend === 'UP' && multiTimeframeData.dailyTrend === 'UP') {
                momentumScore += 10; // 모든 타임프레임 상승
            } else if (multiTimeframeData.hourlyTrend === 'DOWN' && multiTimeframeData.dailyTrend === 'DOWN') {
                momentumScore -= 10; // 모든 타임프레임 하락
            }
        }

        momentumScore = Math.max(-40, Math.min(40, momentumScore));

        // ============================================
        // 3. Fundamental Score (최대 10점)
        // ============================================
        if (fundamentalData) {
            // P/E 비율 (최대 5점)
            if (fundamentalData.peRatio) {
                if (fundamentalData.peRatio > 0 && fundamentalData.peRatio < 20) {
                    fundamentalScore += 5;
                } else if (fundamentalData.peRatio >= 20 && fundamentalData.peRatio < 35) {
                    fundamentalScore += 3;
                } else if (fundamentalData.peRatio >= 35) {
                    fundamentalScore += 0; // 고평가
                }
            }

            // PEG 비율 (최대 5점)
            if (fundamentalData.pegRatio) {
                if (fundamentalData.pegRatio > 0 && fundamentalData.pegRatio < 1) {
                    fundamentalScore += 5;
                } else if (fundamentalData.pegRatio >= 1 && fundamentalData.pegRatio < 2) {
                    fundamentalScore += 3;
                }
            }
        }
        fundamentalScore = Math.max(0, Math.min(10, fundamentalScore));

        // ============================================
        // 4. Sentiment Score (최대 15점)
        // ============================================
        if (newsData) {
            if (newsData.sentiment === 'POSITIVE') {
                sentimentScore = 15;
            } else if (newsData.sentiment === 'NEGATIVE') {
                sentimentScore = -15;
            } else {
                sentimentScore = 0;
            }

            // 뉴스 양에 따른 조정 (뉴스가 많으면 신뢰도 높음)
            if (newsData.headlineCount >= 5) {
                sentimentScore = Math.round(sentimentScore * 1.2);
            } else if (newsData.headlineCount <= 1) {
                sentimentScore = Math.round(sentimentScore * 0.5);
            }
        }
        sentimentScore = Math.max(-15, Math.min(15, sentimentScore));

        // ============================================
        // 5. Volatility Score (최대 10점) - 신규
        // ============================================
        if (volatilityData) {
            // ATR 기반 변동성 점수
            // 높은 변동성 = 높은 수익 기회 (데이트레이딩)
            if (volatilityData.atrPercent >= 3) {
                volatilityScore = 10; // 높은 변동성 = 좋은 기회
            } else if (volatilityData.atrPercent >= 2) {
                volatilityScore = 7;
            } else if (volatilityData.atrPercent >= 1) {
                volatilityScore = 4;
            } else {
                volatilityScore = 0; // 낮은 변동성 = 기회 적음
            }

            // 거래량 스파이크 보너스
            if (volatilityData.volumeSpike && volatilityData.volumeSpike > 2) {
                volatilityScore += 5; // 거래량 2배 이상 스파이크
            }
        }
        volatilityScore = Math.max(0, Math.min(10, volatilityScore));

        // ============================================
        // 종합 점수 계산
        // ============================================
        const totalScore = technicalScore + momentumScore + fundamentalScore +
            sentimentScore + volatilityScore;

        // 점수 정규화 (0-100 범위로)
        const normalizedScore = Math.max(0, Math.min(100, totalScore + 50));

        return {
            totalScore: normalizedScore,
            rawScore: totalScore,
            breakdown: {
                technical: technicalScore,
                momentum: momentumScore,
                fundamental: fundamentalScore,
                sentiment: sentimentScore,
                volatility: volatilityScore
            },
            recommendation: this.getRecommendation(normalizedScore),
            confidence: this.getConfidence(normalizedScore, technicalData, newsData)
        };
    }

    getRecommendation(score) {
        if (score >= this.thresholds.strongBuy) return 'STRONG_BUY';
        if (score >= this.thresholds.buy) return 'BUY';
        if (score <= this.thresholds.strongSell) return 'STRONG_SELL';
        if (score <= this.thresholds.sell) return 'SELL';
        return 'HOLD';
    }

    getConfidence(score, technicalData, newsData) {
        let confidence = 50; // 기본 신뢰도

        // 점수가 극단적일수록 높은 신뢰도
        if (score >= 85 || score <= 15) {
            confidence += 20;
        } else if (score >= 75 || score <= 25) {
            confidence += 10;
        }

        // 여러 신호가 일치하면 높은 신뢰도
        if (technicalData && technicalData.signals) {
            const bullishSignals = technicalData.signals.filter(s =>
                ['MACD_BULLISH', 'MA_UPTREND', 'RSI_OVERSOLD', 'BB_OVERSOLD'].includes(s)
            ).length;
            const bearishSignals = technicalData.signals.filter(s =>
                ['MACD_BEARISH', 'RSI_OVERBOUGHT', 'BB_OVERBOUGHT'].includes(s)
            ).length;

            if (bullishSignals >= 3) confidence += 15;
            else if (bullishSignals >= 2) confidence += 10;
            if (bearishSignals >= 3) confidence += 15;
            else if (bearishSignals >= 2) confidence += 10;
        }

        // 뉴스 감성이 기술적 분석과 일치하면 높은 신뢰도
        if (newsData && technicalData) {
            const isBullishTechnical = technicalData.score > 0;
            const isBullishNews = newsData.sentiment === 'POSITIVE';
            if (isBullishTechnical === isBullishNews) {
                confidence += 10;
            }
        }

        return Math.min(100, confidence);
    }

    /**
     * 종목 우선순위 정렬
     * 점수 + 변동성 + 신뢰도 기반
     */
    rankStocks(stocksWithScores) {
        return stocksWithScores.sort((a, b) => {
            // 1차: 점수
            if (b.totalScore !== a.totalScore) {
                return b.totalScore - a.totalScore;
            }
            // 2차: 신뢰도
            if (b.confidence !== a.confidence) {
                return b.confidence - a.confidence;
            }
            // 3차: 변동성 (높을수록 우선)
            const aVol = a.breakdown?.volatility || 0;
            const bVol = b.breakdown?.volatility || 0;
            return bVol - aVol;
        });
    }
}

module.exports = new EnhancedMultiFactorScreener();