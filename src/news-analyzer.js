const yahooFinance = require('yahoo-finance2').default;

class NewsAnalyzer {

    /**
     * Analyze news for a specific symbol
     * @param {string} symbol 
     */
    async analyzeNews(symbol) {
        try {
            // Fetch news using Yahoo Finance
            const result = await yahooFinance.search(symbol, { newsCount: 5 });
            const newsItems = result.news || [];

            let sentimentScore = 0;
            let headlineCount = newsItems.length;

            // Simple Keyword-based Sentiment Analysis
            const positiveKeywords = ['surge', 'jump', 'record', 'beat', 'profit', 'gain', 'bull', 'upgrade', 'buy', 'strong'];
            const negativeKeywords = ['drop', 'fall', 'plunge', 'miss', 'loss', 'weak', 'bear', 'downgrade', 'sell', 'crash'];

            newsItems.forEach(item => {
                const title = item.title.toLowerCase();

                positiveKeywords.forEach(word => {
                    if (title.includes(word)) sentimentScore += 1;
                });

                negativeKeywords.forEach(word => {
                    if (title.includes(word)) sentimentScore -= 1;
                });
            });

            // Normalize sentiment: -1 (Negative) to 1 (Positive)
            // Cap at +/- 5 for normalization
            const normalizedScore = Math.max(-1, Math.min(1, sentimentScore / 3));

            let sentiment = 'NEUTRAL';
            if (normalizedScore > 0.3) sentiment = 'POSITIVE';
            if (normalizedScore < -0.3) sentiment = 'NEGATIVE';

            return {
                sentiment: sentiment,
                score: normalizedScore, // -1 to 1
                headlineCount: headlineCount,
                headlines: newsItems.map(n => n.title).slice(0, 3) // Top 3 titles for logging
            };

        } catch (error) {
            // console.error(`News Error for ${symbol}: ${error.message}`);
            return {
                sentiment: 'NEUTRAL',
                score: 0,
                headlineCount: 0
            };
        }
    }
}

module.exports = new NewsAnalyzer();
