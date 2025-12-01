// process.env.TRADING_MODE = 'PAPER'; // Commented out to use REAL mode from .env
const config = require('./src/config');
const kisApi = require('./src/kis-api');
const logger = require('winston');

console.log('Current Trading Mode:', config.trading.mode);

// Configure logger to output to console
logger.add(new logger.transports.Console({
    format: logger.format.simple()
}));

async function testBuy() {
    try {
        console.log('Starting Test Buy Order...');
        // Symbol: AAPL, Side: BUY, Qty: 1
        // Test 6: NYSE (NYS) Limit Order
        const symbol = 'KO';
        const price = '60.00'; // Limit order price
        const exchange = 'NYSE'; // Will be mapped to NYS
        const orderType = '00'; // Limit

        console.log(`Placing order: ${symbol} ${exchange} ${price} ${orderType}`);
        const result = await kisApi.placeOrder(symbol, 'BUY', 1, price, exchange, orderType);
        console.log('Test Buy Result:', result);
    } catch (error) {
        console.error('Test Buy Failed:', error);
    }
}

testBuy();
