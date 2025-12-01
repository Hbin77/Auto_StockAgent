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

// Schedule: Every 1 minute for continuous monitoring
cron.schedule('* * * * *', () => {
    // Auto Shutdown Check (US Market Close is 06:00 AM KST)
    // We shut down at 06:10 AM to allow for final processing.
    const now = new Date();
    const kstTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const currentHour = kstTime.getHours();
    const currentMinute = kstTime.getMinutes();

    // If it's 06:10 AM or later (but before 07:00 AM to avoid evening shutdown), exit.
    if (currentHour === 6 && currentMinute >= 10) {
        logger.info('Market Closed (06:10 AM KST). Shutting down agent...');
        process.exit(0);
    }

    logger.info('Running scheduled trading task...');
    trader.start();
});
