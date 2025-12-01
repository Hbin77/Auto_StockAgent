const { SMA, RSI, BollingerBands } = require('technicalindicators');

class StockTools {

    /**
     * Calculate Moving Average
     * @param {Array<number>} prices 
     * @param {number} period 
     */
    calculateMA(prices, period) {
        if (prices.length < period) return [];
        return SMA.calculate({ period: period, values: prices });
    }

    /**
     * Calculate RSI
     * @param {Array<number>} prices 
     * @param {number} period 
     */
    calculateRSI(prices, period = 14) {
        if (prices.length < period) return [];
        return RSI.calculate({ period: period, values: prices });
    }

    /**
     * Analyze basic signals
     * @param {Array<Object>} historicalData - Array of { close, volume, ... }
     */
    analyze(historicalData) {
        const closes = historicalData.map(d => d.close);

        const ma20 = this.calculateMA(closes, 20);
        const ma50 = this.calculateMA(closes, 50);
        const rsi = this.calculateRSI(closes, 14);

        const currentPrice = closes[closes.length - 1];
        const currentMA20 = ma20[ma20.length - 1];
        const currentMA50 = ma50[ma50.length - 1];
        const currentRSI = rsi[rsi.length - 1];

        let signal = 'NEUTRAL';

        // Golden Cross: MA20 crosses above MA50 (simplified check: current state)
        // Buy: Price > MA20 > MA50 OR RSI < 30
        if ((currentPrice > currentMA20 && currentMA20 > currentMA50) || currentRSI < 30) {
            signal = 'BUY';
        }
        // Sell: Price < MA20 < MA50 OR RSI > 70
        else if ((currentPrice < currentMA20 && currentMA20 < currentMA50) || currentRSI > 70) {
            signal = 'SELL';
        }

        return {
            ma20: currentMA20,
            ma50: currentMA50,
            rsi: currentRSI,
            signal: signal,
            price: currentPrice
        };
    }
}

module.exports = new StockTools();
