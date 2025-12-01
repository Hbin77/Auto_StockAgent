const axios = require('axios');
const config = require('./config');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'kis-api.log' })
    ]
});

class KisApi {
    constructor() {
        this.baseUrl = config.kis.baseUrl;
        this.appKey = config.kis.appKey;
        this.appSecret = config.kis.appSecret;
        this.accountNo = config.kis.accountNo;
        this.accountCode = config.kis.accountCode;
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    async getAuthToken() {
        if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
            return this.accessToken;
        }

        try {
            const response = await axios.post(`${this.baseUrl}/oauth2/tokenP`, {
                grant_type: 'client_credentials',
                appkey: this.appKey,
                appsecret: this.appSecret
            });

            this.accessToken = response.data.access_token;
            this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000) - 60000); // Buffer 1 min
            logger.info('KIS API Token refreshed');
            return this.accessToken;
        } catch (error) {
            logger.error(`KIS Auth Error: ${error.message}`);
            throw error;
        }
    }

    async getHeaders(trId) {
        const token = await this.getAuthToken();
        return {
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': `Bearer ${token}`,
            'appkey': this.appKey,
            'appsecret': this.appSecret,
            'tr_id': trId,
            'custtype': 'P' // Individual
        };
    }

    /**
     * Get Account Balance (Overseas Stock)
     * Note: TR ID varies for real/paper and specific market. Assuming US Stock.
     */
    async getBalance() {
        try {
            // TR ID for Overseas Stock Balance (Paper Trading: VTTS3012R, Real: TTTS3012R - Example, verify docs)
            // For simplicity in this demo, we'll assume a generic check or mock if keys aren't real.
            // Using a common TR ID for US Stock Balance inquiry.
            const trId = config.trading.mode === 'REAL' ? 'TTTS3012R' : 'VTTS3012R';

            const headers = await this.getHeaders(trId);
            const params = {
                CANO: this.accountNo,
                ACNT_PRDT_CD: this.accountCode,
                OVRS_EXCG_CD: 'NASD', // Example: NASD, NYSE, AMEX
                TR_CRCY_CD: 'USD',
                CTX_AREA_FK200: '',
                CTX_AREA_NK200: ''
            };

            const response = await axios.get(`${this.baseUrl}/uapi/overseas-stock/v1/trading/inquire-balance`, {
                headers,
                params
            });

            // DEBUG: Log full response to find the correct balance field
            logger.info(`[DEBUG] Balance Response: ${JSON.stringify(response.data)}`);

            // Parse KIS API Response
            // output1: Holdings list
            // output2: Account summary (buying power, etc.)

            const holdings = response.data.output1.map(item => ({
                symbol: item.ovrs_pdno, // Symbol
                qty: Number(item.ovrs_cblc_qty), // Quantity
                avgPrice: Number(item.pchs_avg_pric), // Average Purchase Price
                currentPrice: Number(item.now_pric2), // Current Price
                profitRate: Number(item.evlu_pfls_rt) // Profit Rate
            }));

            // If buying power is 0 from output2, try to fetch "Present Balance" (Cash) separately
            // This is often needed if the user has no holdings or if TTTS3012R doesn't return cash details.
            let buyingPower = Number(response.data.output2.frcr_dncl_amt_2 || 0);

            if (buyingPower === 0) {
                try {
                    logger.info('Attempting to fetch present balance (fallback)...');
                    const cashBalance = await this.getPresentBalance();
                    if (cashBalance > 0) {
                        buyingPower = cashBalance;
                        logger.info(`Fetched Buying Power from Present Balance: $${buyingPower}`);
                    }
                } catch (e) {
                    logger.warn(`Failed to fetch present balance: ${e.message}`);
                }
            }

            const balance = {
                buyingPower: buyingPower,
                totalAsset: Number(response.data.output2.tot_evlu_pfls_amt),
                holdings: holdings
            };

            return balance;
        } catch (error) {
            logger.error(`Get Balance Error: ${error.message}`);
            // Return empty structure on error to prevent crashes
            return { buyingPower: 0, holdings: [] };
        }
    }

    /**
     * Get Purchasable Amount (Buying Power)
     * TR ID: TTTS3007R (Real) / VTTS3007R (Paper)
     */
    async getPresentBalance() {
        const trId = config.trading.mode === 'REAL' ? 'TTTS3007R' : 'VTTS3007R';
        const headers = await this.getHeaders(trId);
        const params = {
            CANO: this.accountNo,
            ACNT_PRDT_CD: this.accountCode,
            OVRS_EXCG_CD: 'NASD', // Exchange
            OVRS_ORD_UNPR: '0', // Price (0 for market/check)
            ITEM_CD: '' // Item code (optional? or maybe need a dummy symbol like AAPL)
        };

        // Note: inquire-psamount might require a symbol to calculate buying power based on margin?
        // Let's try with a dummy symbol if needed, or empty.
        // Docs say ITEM_CD is required. Let's use 'AAPL' as reference.
        params.ITEM_CD = 'AAPL';

        const response = await axios.get(`${this.baseUrl}/uapi/overseas-stock/v1/trading/inquire-psamount`, {
            headers,
            params
        });

        logger.info(`[DEBUG] Purchasable Amount Response: ${JSON.stringify(response.data)}`);

        // output.ovrs_ord_psbl_amt (Overseas Order Purchasable Amount)
        return Number(response.data.output.ovrs_ord_psbl_amt || 0);
    }

    /**
     * Place Order
     * @param {string} symbol 
     * @param {string} side 'BUY' or 'SELL'
     * @param {number} qty 
     * @param {number} price (0 for market price if supported, but usually limit for overseas)
     */
    async placeOrder(symbol, side, qty, price, exchange = 'NASD') {
        try {
            // TR ID: Buy (TTTS3035R/VTTS3035R), Sell (TTTS3036R/VTTS3036R)
            let trId;
            if (config.trading.mode === 'REAL') {
                trId = side === 'BUY' ? 'TTTS3035R' : 'TTTS3036R';
            } else {
                trId = side === 'BUY' ? 'VTTS3035R' : 'VTTS3036R';
            }

            const headers = await this.getHeaders(trId);
            const data = {
                CANO: this.accountNo,
                ACNT_PRDT_CD: this.accountCode,
                OVRS_EXCG_CD: exchange, // NASD, NYSE, AMEX
                PDNO: symbol,
                ORD_QTY: String(qty),
                OVRS_ORD_UNPR: String(Number(price).toFixed(2)),
                ORD_DVSN: '00' // Limit order
            };

            logger.info(`[DEBUG] Order Request Data: ${JSON.stringify(data)}`);

            const response = await axios.post(`${this.baseUrl}/uapi/overseas-stock/v1/trading/order`, data, { headers });

            logger.info(`Order Placed: ${side} ${symbol} ${qty} @ ${price} - Msg: ${response.data.msg1}`);
            return response.data;
        } catch (error) {
            if (error.response) {
                logger.error(`Order Error (${side} ${symbol}): Status ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                logger.error(`Order Error (${side} ${symbol}): ${error.message}`);
            }
            return null;
        }
    }
}

module.exports = new KisApi();
