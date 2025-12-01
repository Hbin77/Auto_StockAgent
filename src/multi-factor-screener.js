class MultiFactorScreener {

    /**
     * Calculate comprehensive score
     * @param {Object} technicalData - Result from DayTradingMonitor
     * @param {Object} fundamentalData - Basic fundamental data (PE, MarketCap, etc.)
     */
    calculateScore(technicalData, fundamentalData) {
        let technicalScore = 0;
        let momentumScore = 0;
        let fundamentalScore = 0;

        // 1. Technical Score (40 points max)
        // Based on DayTradingMonitor score (normalized)
        if (technicalData.score > 20) technicalScore = 40;
        else if (technicalData.score > 0) technicalScore = 20;
        else technicalScore = 10;

        // 2. Momentum Score (30 points max)
        // Simplified: using RSI and MA trend as proxy for momentum if explicit returns not available
        if (technicalData.signals.includes('MA_UPTREND')) momentumScore += 15;
        if (technicalData.signals.includes('MACD_BULLISH')) momentumScore += 15;

        // 3. Fundamental Score (30 points max)
        // Using PE and PEG if available
        if (fundamentalData) {
            if (fundamentalData.peRatio && fundamentalData.peRatio < 30) fundamentalScore += 15;
            if (fundamentalData.pegRatio && fundamentalData.pegRatio < 2) fundamentalScore += 15;
        }

        const totalScore = technicalScore + momentumScore + fundamentalScore;

        return {
            totalScore,
            breakdown: {
                technical: technicalScore,
                momentum: momentumScore,
                fundamental: fundamentalScore
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
