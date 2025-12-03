const { SMA, RSI, MACD, BollingerBands, ATR } = require('technicalindicators');

class DayTradingMonitor {

    calculateIndicators(historicalData) {
        const closes = historicalData.map(d => d.close);
        const highs = historicalData.map(d => d.high);
        const lows = historicalData.map(d => d.low);

        // MA
        const ma5 = SMA.calculate({ period: 5, values: closes });
        const ma10 = SMA.calculate({ period: 10, values: closes });
        const ma20 = SMA.calculate({ period: 20, values: closes });

        // RSI
        const rsi = RSI.calculate({ period: 14, values: closes });

        // MACD
        const macdInput = {
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false
        };
        const macd = MACD.calculate(macdInput);

        // Bollinger Bands
        const bbInput = {
            period: 20,
            values: closes,
            stdDev: 2
        };
        const bb = BollingerBands.calculate(bbInput);

        // ATR
        const atrInput = {
            high: highs,
            low: lows,
            close: closes,
            period: 14
        };
        const atr = ATR.calculate(atrInput);

        return {
            ma5: ma5[ma5.length - 1],
            ma10: ma10[ma10.length - 1],
            ma20: ma20[ma20.length - 1],
            rsi: rsi[rsi.length - 1],
            macd: macd[macd.length - 1], // { MACD, signal, histogram }
            bb: bb[bb.length - 1], // { middle, upper, lower }
            atr: atr[atr.length - 1]
        };
    }

    analyze(historicalData) {
        const indicators = this.calculateIndicators(historicalData);
        const currentPrice = historicalData[historicalData.length - 1].close;

        let score = 0;
        const signals = [];

        // MACD Analysis
        // Histogram > 0 means MACD > Signal
        if (indicators.macd && indicators.macd.histogram > 0) {
            if (indicators.macd.MACD > 0) {
                // Strong Bullish: MACD above zero and rising
                score += 10;
                signals.push('MACD_BULLISH');
            } else {
                // Reversal Candidate: MACD below zero but crossing up
                // Weaker signal, maybe just a bounce in downtrend
                score += 5;
                signals.push('MACD_REVERSAL');
            }
        } else if (indicators.macd && indicators.macd.histogram < 0) {
            score -= 10;
            signals.push('MACD_BEARISH');
        }

        // Bollinger Analysis
        if (indicators.bb) {
            if (currentPrice > indicators.bb.upper) {
                score -= 15; // Overbought warning
                signals.push('BB_OVERBOUGHT');
            } else if (currentPrice < indicators.bb.lower) {
                // Oversold opportunity - but risky in crash.
                // Add score only if RSI is also low but turning up? 
                // For now, keep it but reduce weight slightly or keep as is.
                score += 15;
                signals.push('BB_OVERSOLD');
            }
        }

        // RSI Analysis
        if (indicators.rsi < 30) {
            // Oversold: Potential bounce, but dangerous.
            // Only add positive score if we are NOT in a massive downtrend (MA20 < MA50)?
            // Or just treat as a "setup" that needs confirmation.
            score += 10;
            signals.push('RSI_OVERSOLD');
        } else if (indicators.rsi > 70) {
            score -= 10;
            signals.push('RSI_OVERBOUGHT');
        }

        // Trend Analysis (MA Alignment)
        if (indicators.ma5 > indicators.ma10 && indicators.ma10 > indicators.ma20) {
            score += 10;
            signals.push('MA_UPTREND');
        }

        return {
            indicators,
            score,
            signals,
            currentPrice, // Added currentPrice
            stopLoss: currentPrice - (1.5 * indicators.atr),
            takeProfit: currentPrice + (2 * indicators.atr)
        };
    }
}

module.exports = new DayTradingMonitor();
