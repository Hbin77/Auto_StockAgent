const config = require('./src/config');
const kisApi = require('./src/kis-api');
const logger = require('winston');

console.log('Current Trading Mode:', config.trading.mode);

// Configure logger to output to console
logger.add(new logger.transports.Console({
    format: logger.format.simple()
}));

async function testSell() {
    try {
        console.log('Starting Test Sell Order...');
        // Symbol: AAPL, Side: SELL, Qty: 1
        // Using Market Order for simplicity in testing format
        const symbol = 'AAPL';
        const price = '0'; // Market order price
        const exchange = 'NASD';
        const orderType = '01'; // Market

        console.log(`Placing SELL order: ${symbol} ${exchange} ${price} ${orderType}`);
        const result = await kisApi.placeOrder(symbol, 'SELL', 1, price, exchange, orderType);
        console.log('Test Sell Result:', result);
    } catch (error) {
        console.error('Test Sell Failed:', error);
    }
}

testSell();
