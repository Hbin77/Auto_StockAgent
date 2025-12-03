/**
 * Position Manager
 * 트레일링 스탑, 포지션 사이징, 리스크 관리
 */

const fs = require('fs');
const path = require('path');

class PositionManager {
    constructor() {
        this.positionsFile = path.join(__dirname, '../data/positions.json');
        this.positions = this._loadPositions();

        // 설정
        this.config = {
            // 트레일링 스탑 설정
            trailingStop: {
                activationProfit: 2.0,  // 2% 수익 시 트레일링 스탑 활성화
                trailingPercent: 1.5,   // 고점 대비 1.5% 하락 시 청산
                initialStopLoss: -3.0,  // 초기 손절선 -3%
                breakEvenMove: 1.0      // 1% 수익 시 손절선을 본전으로 이동
            },

            // 포지션 사이징 설정
            positionSizing: {
                maxPositionPercent: 5.0,    // 최대 포지션 크기 (총 자산의 5%)
                minPositionPercent: 1.0,    // 최소 포지션 크기 (총 자산의 1%)
                maxTotalExposure: 80.0,     // 최대 총 노출 (총 자산의 80%)
                maxPositionsCount: 20,       // 최대 포지션 개수
                scoreBasedSizing: true       // 점수 기반 사이징 활성화
            },

            // 익절 목표
            takeProfit: {
                level1: { percent: 3.0, sellPercent: 30 },  // 3% 수익 시 30% 청산
                level2: { percent: 5.0, sellPercent: 30 },  // 5% 수익 시 30% 청산
                level3: { percent: 10.0, sellPercent: 40 }  // 10% 수익 시 나머지 청산
            }
        };
    }

    _loadPositions() {
        try {
            if (fs.existsSync(this.positionsFile)) {
                const data = fs.readFileSync(this.positionsFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Failed to load positions:', error.message);
        }
        return {};
    }

    _savePositions() {
        try {
            const dir = path.dirname(this.positionsFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.positionsFile, JSON.stringify(this.positions, null, 2));
        } catch (error) {
            console.error('Failed to save positions:', error.message);
        }
    }

    /**
     * 포지션 추가/업데이트
     */
    addPosition(symbol, entryPrice, quantity, score = 50) {
        this.positions[symbol] = {
            symbol,
            entryPrice,
            quantity,
            score,
            entryTime: Date.now(),
            highestPrice: entryPrice,
            lowestPrice: entryPrice,
            trailingStopActive: false,
            currentStopLoss: entryPrice * (1 + this.config.trailingStop.initialStopLoss / 100),
            takeProfitLevelsHit: []
        };
        this._savePositions();
        return this.positions[symbol];
    }

    /**
     * 포지션 삭제
     */
    removePosition(symbol) {
        if (this.positions[symbol]) {
            delete this.positions[symbol];
            this._savePositions();
            return true;
        }
        return false;
    }

    /**
     * 포지션 동기화 (실제 보유하지 않은 포지션 제거)
     * @param {Array} holdings - KIS API에서 가져온 현재 보유 종목 리스트
     */
    syncPositions(holdings) {
        const currentSymbols = new Set(holdings.map(h => h.symbol));
        const storedSymbols = Object.keys(this.positions);
        let changed = false;

        for (const symbol of storedSymbols) {
            if (!currentSymbols.has(symbol)) {
                console.log(`[PositionManager] Removing stale position: ${symbol}`);
                delete this.positions[symbol];
                changed = true;
            }
        }

        if (changed) {
            this._savePositions();
        }
    }

    /**
     * 가격 업데이트 및 트레일링 스탑 체크
     */
    updatePrice(symbol, currentPrice) {
        const position = this.positions[symbol];
        if (!position) return null;

        const profitPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

        // 최고가 업데이트
        if (currentPrice > position.highestPrice) {
            position.highestPrice = currentPrice;
        }

        // 최저가 업데이트
        if (currentPrice < position.lowestPrice) {
            position.lowestPrice = currentPrice;
        }

        const result = {
            symbol,
            currentPrice,
            entryPrice: position.entryPrice,
            profitPercent,
            highestPrice: position.highestPrice,
            action: 'HOLD',
            reason: ''
        };

        // 1. 초기 손절 체크
        if (profitPercent <= this.config.trailingStop.initialStopLoss) {
            result.action = 'STOP_LOSS';
            result.reason = `Stop loss triggered at ${profitPercent.toFixed(2)}%`;
            this._savePositions();
            return result;
        }

        // 2. 본전 이동 체크
        if (profitPercent >= this.config.trailingStop.breakEvenMove &&
            position.currentStopLoss < position.entryPrice) {
            position.currentStopLoss = position.entryPrice * 1.001; // 약간의 버퍼
            result.reason = 'Stop loss moved to break-even';
        }

        // 3. 트레일링 스탑 활성화 체크
        if (profitPercent >= this.config.trailingStop.activationProfit) {
            position.trailingStopActive = true;

            // 새로운 트레일링 스탑 레벨 계산
            const trailingStopPrice = position.highestPrice *
                (1 - this.config.trailingStop.trailingPercent / 100);

            // 스탑이 더 높으면 업데이트
            if (trailingStopPrice > position.currentStopLoss) {
                position.currentStopLoss = trailingStopPrice;
            }
        }

        // 4. 트레일링 스탑 트리거 체크
        if (position.trailingStopActive && currentPrice <= position.currentStopLoss) {
            result.action = 'TRAILING_STOP';
            result.reason = `Trailing stop triggered. High: $${position.highestPrice.toFixed(2)}, Stop: $${position.currentStopLoss.toFixed(2)}`;
            this._savePositions();
            return result;
        }

        // 5. 익절 레벨 체크
        const takeProfitResult = this._checkTakeProfitLevels(position, profitPercent);
        if (takeProfitResult.action) {
            result.action = takeProfitResult.action;
            result.reason = takeProfitResult.reason;
            result.sellPercent = takeProfitResult.sellPercent;
        }

        this._savePositions();
        return result;
    }

    _checkTakeProfitLevels(position, profitPercent) {
        const levels = this.config.takeProfit;

        // 레벨 3 (10%+)
        if (profitPercent >= levels.level3.percent &&
            !position.takeProfitLevelsHit.includes(3)) {
            position.takeProfitLevelsHit.push(3);
            return {
                action: 'TAKE_PROFIT_L3',
                reason: `Take profit level 3 (${profitPercent.toFixed(2)}%)`,
                sellPercent: levels.level3.sellPercent
            };
        }

        // 레벨 2 (5%+)
        if (profitPercent >= levels.level2.percent &&
            !position.takeProfitLevelsHit.includes(2)) {
            position.takeProfitLevelsHit.push(2);
            return {
                action: 'TAKE_PROFIT_L2',
                reason: `Take profit level 2 (${profitPercent.toFixed(2)}%)`,
                sellPercent: levels.level2.sellPercent
            };
        }

        // 레벨 1 (3%+)
        if (profitPercent >= levels.level1.percent &&
            !position.takeProfitLevelsHit.includes(1)) {
            position.takeProfitLevelsHit.push(1);
            return {
                action: 'TAKE_PROFIT_L1',
                reason: `Take profit level 1 (${profitPercent.toFixed(2)}%)`,
                sellPercent: levels.level1.sellPercent
            };
        }

        return { action: null };
    }

    /**
     * 포지션 사이즈 계산
     * @param {number} totalCapital - 총 자본
     * @param {number} currentPrice - 현재 주가
     * @param {number} score - 분석 점수 (0-100)
     * @param {number} regimeMultiplier - 시장 레짐 멀티플라이어
     * @param {number} atr - ATR (변동성)
     */
    calculatePositionSize(totalCapital, currentPrice, score, regimeMultiplier = 1.0, atr = null) {
        const config = this.config.positionSizing;

        // 1. 기본 포지션 크기 (점수 기반)
        let positionPercent;
        if (config.scoreBasedSizing) {
            if (score >= 90) {
                positionPercent = config.maxPositionPercent;
            } else if (score >= 80) {
                positionPercent = config.maxPositionPercent * 0.8;
            } else if (score >= 70) {
                positionPercent = config.maxPositionPercent * 0.6;
            } else if (score >= 60) {
                positionPercent = config.maxPositionPercent * 0.4;
            } else {
                positionPercent = config.minPositionPercent;
            }
        } else {
            positionPercent = config.maxPositionPercent * 0.5; // 기본값
        }

        // 2. 시장 레짐 적용
        positionPercent *= regimeMultiplier;

        // 3. ATR 기반 조정 (변동성이 높으면 포지션 축소)
        if (atr && currentPrice) {
            const atrPercent = (atr / currentPrice) * 100;
            if (atrPercent > 5) {
                positionPercent *= 0.5; // 변동성 5% 이상이면 절반
            } else if (atrPercent > 3) {
                positionPercent *= 0.75;
            }
        }

        // 4. 최소/최대 제한 적용
        positionPercent = Math.max(config.minPositionPercent,
            Math.min(config.maxPositionPercent, positionPercent));

        // 5. 실제 금액 및 수량 계산
        const positionValue = totalCapital * (positionPercent / 100);
        const quantity = Math.floor(positionValue / currentPrice);

        // 최소 1주
        const finalQuantity = Math.max(1, quantity);
        const actualValue = finalQuantity * currentPrice;
        const actualPercent = (actualValue / totalCapital) * 100;

        return {
            quantity: finalQuantity,
            value: actualValue,
            percent: actualPercent,
            score,
            regimeMultiplier
        };
    }

    /**
     * 현재 총 노출도 계산
     */
    calculateTotalExposure(holdings, totalCapital) {
        if (!holdings || holdings.length === 0) return 0;

        const totalValue = holdings.reduce((sum, h) => sum + ((h.currentValue || (h.currentPrice * h.qty)) || 0), 0);
        return (totalValue / totalCapital) * 100;
    }

    /**
     * 새 포지션 추가 가능 여부 확인
     */
    canAddPosition(holdings, totalCapital, newPositionValue) {
        const currentExposure = this.calculateTotalExposure(holdings, totalCapital);
        const newExposurePercent = (newPositionValue / totalCapital) * 100;
        const totalExposure = currentExposure + newExposurePercent;

        const config = this.config.positionSizing;

        if (holdings.length >= config.maxPositionsCount) {
            return {
                allowed: false,
                reason: `Max positions (${config.maxPositionsCount}) reached`
            };
        }

        if (totalExposure > config.maxTotalExposure) {
            return {
                allowed: false,
                reason: `Max exposure (${config.maxTotalExposure}%) would be exceeded`
            };
        }

        return {
            allowed: true,
            currentExposure,
            newExposure: totalExposure
        };
    }

    /**
     * 모든 포지션 가져오기
     */
    getAllPositions() {
        return this.positions;
    }

    /**
     * 특정 포지션 가져오기
     */
    getPosition(symbol) {
        return this.positions[symbol] || null;
    }

    /**
     * 포지션 존재 여부 확인
     */
    hasPosition(symbol) {
        return !!this.positions[symbol];
    }
}

module.exports = new PositionManager();