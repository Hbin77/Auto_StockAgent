class MultiFactorScreener {

    /**
     * Calculate comprehensive score
     * @param {Object} technicalData - Result from DayTradingMonitor
     * @param {Object} fundamentalData - Basic fundamental data (PE, MarketCap, etc.)
     * @param {Object} newsData - Result from NewsAnalyzer
     */
    calculateScore(technicalData, fundamentalData, newsData) {
        let technicalScore = 0;
        let momentumScore = 0;
        let fundamentalScore = 0;
        let sentimentScore = 0;

        // 1. Technical Score (40 points max)
        if (technicalData.score > 20) technicalScore = 40;
        else if (technicalData.score > 0) technicalScore = 20;
        else technicalScore = 10;

        // 2. Momentum Score (30 points max)
        if (technicalData.signals.includes('MA_UPTREND')) momentumScore += 15;
        if (technicalData.signals.includes('MACD_BULLISH')) momentumScore += 15;
        if (technicalData.signals.includes('MACD_REVERSAL')) momentumScore += 5;
        if (technicalData.signals.includes('MACD_BEARISH')) momentumScore -= 15;

        // 3. Fundamental Score (20 points max - reduced to make room for sentiment)
        if (fundamentalData) {
            if (fundamentalData.peRatio && fundamentalData.peRatio < 30) fundamentalScore += 10;
            if (fundamentalData.pegRatio && fundamentalData.pegRatio < 2) fundamentalScore += 10;
        }

        // 4. Sentiment Score (10 points max)
        if (newsData) {
            if (newsData.sentiment === 'POSITIVE') sentimentScore = 10;
            else if (newsData.sentiment === 'NEGATIVE') sentimentScore = -10;
            // Neutral = 0
        }

        const totalScore = technicalScore + momentumScore + fundamentalScore + sentimentScore;

        return {
            totalScore,
            breakdown: {
                technical: technicalScore,
                momentum: momentumScore,
                fundamental: fundamentalScore,
                sentiment: sentimentScore
            },
            recommendation: this.getRecommendation(totalScore)
        };
    }

    getRecommendation(score) {
        if (score >= 80) return 'STRONG_BUY';
        if (score >= 60) return 'BUY';
        if (score <= 30) return 'SELL';
        return 'HOLD';
    }
}

module.exports = new MultiFactorScreener();
