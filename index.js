const cron = require('node-cron');
const trader = require('./src/trader');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [
        new winston.transports.Console()
    ]
});

logger.info('Auto Stock Agent Started');

// Run immediately on start for testing
trader.start();

// Schedule: Every 5 minutes
cron.schedule('*/5 * * * *', () => {
    logger.info('Running scheduled trading task...');
    trader.start();
});
