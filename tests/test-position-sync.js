const positionManager = require('../src/position-manager');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock positions file
const MOCK_POSITIONS_FILE = path.join(__dirname, '../data/test_positions.json');
positionManager.positionsFile = MOCK_POSITIONS_FILE;

// Setup: Create a dummy position
const setup = () => {
    positionManager.positions = {
        'AAPL': { symbol: 'AAPL', qty: 10, entryPrice: 150 }
    };
    positionManager._savePositions();
};

// Teardown: Cleanup
const teardown = () => {
    if (fs.existsSync(MOCK_POSITIONS_FILE)) {
        fs.unlinkSync(MOCK_POSITIONS_FILE);
    }
};

async function runTests() {
    console.log('Running Position Sync Tests...');

    try {
        // Test 1: Sync with valid holdings (should remove stale)
        setup();
        console.log('Test 1: Sync with valid holdings (should remove stale)...');
        positionManager.syncPositions([{ symbol: 'MSFT', qty: 5 }]); // AAPL is stale
        assert.strictEqual(positionManager.hasPosition('AAPL'), false, 'AAPL should be removed');
        console.log('PASS');

        // Test 2: Sync with null (should NOT remove anything)
        setup();
        console.log('Test 2: Sync with null (should NOT remove anything)...');
        positionManager.syncPositions(null);
        assert.strictEqual(positionManager.hasPosition('AAPL'), true, 'AAPL should persist');
        console.log('PASS');

        // Test 3: Sync with undefined (should NOT remove anything)
        setup();
        console.log('Test 3: Sync with undefined (should NOT remove anything)...');
        positionManager.syncPositions(undefined);
        assert.strictEqual(positionManager.hasPosition('AAPL'), true, 'AAPL should persist');
        console.log('PASS');

        console.log('All tests passed!');
    } catch (error) {
        console.error('Test Failed:', error);
        process.exit(1);
    } finally {
        teardown();
    }
}

runTests();
