const newsAnalyzer = require('../src/news-analyzer');

// Mock Yahoo Finance for testing logic (we can't easily mock the module import here without a framework, 
// so we will test the logic by temporarily exposing the logic or just trusting the integration test.
// Actually, let's just create a standalone test that mimics the logic since we can't inject the mock easily into the singleton instance without refactoring.)

// Wait, I can just copy the logic to test it, OR I can rely on the fact that I just wrote it.
// Better: Let's run the actual module against a real symbol and see what it finds.
// AND let's add a unit test function to the module or just test the logic here.

async function testRealNews() {
    console.log('--- Testing Real News Fetching ---');
    const symbol = 'AAPL';
    console.log(`Fetching news for ${symbol}...`);
    const result = await newsAnalyzer.analyzeNews(symbol);
    console.log('Result:', JSON.stringify(result, null, 2));
}

// We can't easily unit test the private logic inside the class without exporting it or mocking the dependency.
// But we can verify if the "Real" fetch works and returns reasonable data.

testRealNews();
