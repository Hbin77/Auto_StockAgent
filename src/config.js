require('dotenv').config();

module.exports = {
    kis: {
        appKey: process.env.KIS_APP_KEY,
        appSecret: process.env.KIS_APP_SECRET,
        accountNo: process.env.KIS_ACCOUNT_NO,
        accountCode: process.env.KIS_ACCOUNT_CODE || '01',
        baseUrl: process.env.KIS_BASE_URL || 'https://openapivts.koreainvestment.com:29443',
    },
    trading: {
        mode: process.env.TRADING_MODE || 'PAPER', // REAL or PAPER
    },
    tickers: {
        // Load S&P 500 tickers
        sp500: require('./sp500-loader'),
        nasdaq100: ['AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'META', 'TSLA', 'AVGO', 'PEP', 'COST'], // Keep for reference
        // High Volatility & Budget Friendly (<$50) for Max Yield Strategy
        budgetGrowth: [
            // Tech/AI/Growth
            'SOFI', 'PLTR', 'PATH', 'IONQ', 'HOOD', 'DKNG', 'RIVN', 'LCID', 'OPEN',
            // Crypto/Blockchain (High Beta)
            'MARA', 'CLSK', 'COIN',
            // Stable/Value (Balance)
            'F', 'T', 'PFE', 'INTC', 'BAC', 'KDP', 'NU', 'GRAB'
        ]
    }
};
