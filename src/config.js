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
        // Sample tickers for Nasdaq 100 and S&P 500 (Top ones for demo/MVP)
        // In a real full app, we might fetch the full list dynamically or from a file.
        nasdaq100: ['AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'META', 'TSLA', 'AVGO', 'PEP', 'COST'],
        sp500: ['JPM', 'V', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'KO', 'LLY']
    }
};
