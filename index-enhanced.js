/**
 * Auto Stock Agent - Enhanced Version
 * 수익률 극대화 전략이 적용된 자동 주식 매매 에이전트
 * 
 * 적용된 전략:
 * 1. 트레일링 스탑 (Trailing Stop) - 수익 보호
 * 2. 시장 레짐 필터 (Market Regime Filter) - VIX/SPY 기반 시장 판단
 * 3. 포지션 사이징 (Position Sizing) - 리스크 관리
 * 4. 변동성 기반 종목 집중 - 수익 기회 극대화
 * 5. 스코어링 가중치 최적화 - 모멘텀 중심
 * 6. 멀티 타임프레임 분석 - 신호 신뢰도 향상
 * 7. 시간대별 전략 - 시장 세션 최적화
 */

const cron = require('node-cron');
const enhancedTrader = require('./src/enhanced-trader');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console()
    ]
});

// 배너 출력
console.log(`
╔═══════════════════════════════════════════════════════════════╗
║       🚀 AUTO STOCK AGENT - ENHANCED VERSION 🚀               ║
╠═══════════════════════════════════════════════════════════════╣
║  Applied Strategies:                                          ║
║  ✅ Trailing Stop         - Protect profits                  ║
║  ✅ Market Regime Filter  - VIX/SPY based decisions          ║
║  ✅ Position Sizing       - Risk management                  ║
║  ✅ Volatility Focus      - High opportunity stocks          ║
║  ✅ Enhanced Scoring      - Momentum weighted                ║
║  ✅ Multi-Timeframe       - Signal confirmation              ║
║  ✅ Session Strategy      - Market hours optimization        ║
╚═══════════════════════════════════════════════════════════════╝
`);

logger.info('Enhanced Auto Stock Agent Starting...');

// 즉시 실행 (테스트용)
enhancedTrader.start();

// 스케줄: 1분마다 실행
cron.schedule('* * * * *', () => {
    const now = new Date();
    const kstTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const currentHour = kstTime.getHours();
    const currentMinute = kstTime.getMinutes();

    // 미국 장 마감 후 종료 (한국시간 06:10 AM)
    if (currentHour === 6 && currentMinute >= 10) {
        logger.info('US Market Closed (06:10 AM KST). Shutting down...');

        // 최종 통계 출력
        const stats = enhancedTrader.getStats();
        logger.info('=== Final Trading Statistics ===');
        logger.info(`Total Trades: ${stats.totalTrades}`);
        logger.info(`Win Rate: ${stats.winRate}`);
        logger.info(`Total Profit: $${stats.totalProfit.toFixed(2)}`);

        process.exit(0);
    }

    logger.info('Running scheduled trading cycle...');
    enhancedTrader.start();
});

// 정상 종료 처리
process.on('SIGINT', () => {
    logger.info('Received SIGINT. Graceful shutdown...');
    const stats = enhancedTrader.getStats();
    logger.info(`Final Stats - Trades: ${stats.totalTrades}, Win Rate: ${stats.winRate}`);
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM. Graceful shutdown...');
    process.exit(0);
});