const axios = require('axios');
const config = require('./config');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const TOKEN_FILE = path.join(__dirname, '../token.json');

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
        this.appKey = config.kis.appKey ? config.kis.appKey.trim() : '';
        this.appSecret = config.kis.appSecret ? config.kis.appSecret.trim() : '';
        this.accountNo = config.kis.accountNo ? config.kis.accountNo.trim() : '';
        this.accountCode = config.kis.accountCode ? config.kis.accountCode.trim() : '';
        this.accessToken = null;
        this.tokenExpiry = null;
    }


    async getAuthToken() {
        if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
            return this.accessToken;
        }

        // Try to load from file
        try {
            if (fs.existsSync(TOKEN_FILE)) {
                const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
                if (new Date(data.expiry) > new Date()) {
                    this.accessToken = data.token;
                    this.tokenExpiry = new Date(data.expiry);
                    // logger.info('KIS API Token loaded from file');
                    return this.accessToken;
                }
            }
        } catch (e) {
            logger.warn('Failed to load token from file');
        }

        try {
            const response = await axios.post(`${this.baseUrl}/oauth2/tokenP`, {
                grant_type: 'client_credentials',
                appkey: this.appKey,
                appsecret: this.appSecret
            });

            this.accessToken = response.data.access_token;
            this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000) - 60000); // Buffer 1 min

            // Save to file
            try {
                fs.writeFileSync(TOKEN_FILE, JSON.stringify({
                    token: this.accessToken,
                    expiry: this.tokenExpiry
                }));
            } catch (e) {
                logger.warn('Failed to save token to file');
            }

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
                qty: Number(item.ord_psbl_qty), // Use Order Possible Qty instead of Total Balance Qty
                avgPrice: Number(item.pchs_avg_pric), // Average Purchase Price
                currentPrice: Number(item.now_pric2), // Current Price
                profitRate: Number(item.evlu_pfls_rt) // Profit Rate
            })).filter(h => h.qty > 0); // Only keep holdings with available quantity

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
            // Return null on error to indicate failure, preventing downstream data loss
            return null;
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

    async getHashKey(data) {
        try {
            const headers = {
                'content-type': 'application/json; charset=utf-8',
                'appkey': this.appKey,
                'appsecret': this.appSecret
            };
            const response = await axios.post(`${this.baseUrl}/uapi/hashkey`, data, { headers });
            logger.info(`Generated HashKey: ${response.data.HASH}`);
            return response.data.HASH;
        } catch (error) {
            logger.error(`Get HashKey Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Place Order
     * @param {string} symbol 
     * @param {string} side 'BUY' or 'SELL'
     * @param {number} qty 
     * @param {number} price (0 for market price if supported, but usually limit for overseas)
     * @param {string} exchange
     * @param {string} orderType '00' (Limit) or '01' (Market)
     */
    async placeOrder(symbol, side, qty, price, exchange = 'NASD', orderType = '00') {
        try {
            // TR ID: Buy (TTTT1002U/VTTT1002U), Sell (TTTT1006U/VTTT1006U) - US Stock
            // Updated based on KIS API Documentation [v1_OverseasStock-001]
            let trId;
            if (config.trading.mode === 'REAL') {
                trId = side === 'BUY' ? 'TTTT1002U' : 'TTTT1006U';
            } else {
                trId = side === 'BUY' ? 'VTTT1002U' : 'VTTT1006U';
            }

            let headers = await this.getHeaders(trId);

            const data = {
                CANO: this.accountNo,
                ACNT_PRDT_CD: this.accountCode,
                OVRS_EXCG_CD: exchange, // NASD, NYSE, AMEX
                PDNO: symbol,
                ORD_QTY: String(qty),
                OVRS_ORD_UNPR: typeof price === 'string' ? price : String(Number(price).toFixed(2)),
                ORD_DVSN: orderType, // Limit order or Market
                ORD_SVR_DVSN_CD: 'V' // Order Server Division Code (Try V)
            };

            // Generate HashKey for POST requests (Real Trading usually requires it)
            const hashkey = await this.getHashKey(data);
            if (hashkey) {
                headers['hashkey'] = hashkey;
            }

            logger.info(`[DEBUG] Order Request (TR_ID: ${trId}): ${JSON.stringify(data)}`);

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

    /**
     * Get Unfilled Orders
     * TR ID: TTTS3018R (Real)
     */
    async getUnfilledOrders() {
        try {
            // TR ID: TTTS3018R (Real) - Confirmed by user image
            // Note: Documentation says TTTS3018R for Overseas Unfilled.
            const trId = 'TTTS3018R';
            const headers = await this.getHeaders(trId);

            const params = {
                CANO: this.accountNo,
                ACNT_PRDT_CD: this.accountCode,
                OVRS_EXCG_CD: 'NASD', // Default to NASD for inquiry
                SORT_SQN: 'DS', // Descending sort
                CTX_AREA_FK200: '',
                CTX_AREA_NK200: ''
            };

            const response = await axios.get(`${this.baseUrl}/uapi/overseas-stock/v1/trading/inquire-nccs`, {
                headers,
                params
            });

            logger.info(`[DEBUG] Unfilled Orders Response: ${JSON.stringify(response.data)}`);

            if (response.data.rt_cd !== '0') {
                logger.error(`Failed to fetch unfilled orders: ${response.data.msg1}`);
                return [];
            }

            return response.data.output.map(item => ({
                orderNo: item.odno, // Original Order Number
                symbol: item.pdno,
                qty: Number(item.nccs_qty), // Unfilled Quantity
                price: Number(item.ord_unpr),
                orderTime: item.ord_dt, // Order Date (YYYYMMDD)
                orderTimeTime: item.ord_tmd, // Order Time (HHMMSS)
                exchange: item.ovrs_excg_cd // Capture Exchange Code (NYSE, NASD, etc.)
            }));
        } catch (error) {
            logger.error(`Error fetching unfilled orders: ${error.message}`);
            return [];
        }
    }

    /**
     * Cancel an order
     * @param {string} orderNo - Original Order Number (ODNO)
     * @param {string} symbol - Stock Symbol
     * @param {number} qty - Quantity to cancel (0 for all)
     * @param {string} exchange - Exchange Code (NASD, NYSE, etc.)
     */
    async cancelOrder(orderNo, symbol, qty = 0, exchange = 'NASD') {
        try {
            // TR ID: TTTT1004U (Real) / VTTT1004U (Paper) - Overseas Stock Cancel
            const trId = config.trading.mode === 'REAL' ? 'TTTT1004U' : 'VTTT1004U';
            const headers = await this.getHeaders(trId);

            // Map Exchange Code if necessary (KIS uses NASD, NYSE, AMEX)
            // Yahoo might give 'NAS', 'NYS'. KIS Unfilled gives 'NASD', 'NYSE'.
            // Ensure we use KIS compatible codes.
            let kisExchange = exchange;
            if (exchange === 'NAS') kisExchange = 'NASD';
            if (exchange === 'NYS') kisExchange = 'NYSE';

            const data = {
                CANO: this.accountNo,
                ACNT_PRDT_CD: this.accountCode,
                OVRS_EXCG_CD: kisExchange, // Use dynamic exchange
                PDNO: symbol,
                ORGN_ODNO: orderNo,
                RVSE_CNCL_DVSN_CD: '02', // 01: Modify, 02: Cancel
                ORD_QTY: qty === 0 ? '0' : String(qty), // 0 means cancel all
                OVRS_ORD_UNPR: '0', // Price (0 for cancel)
                ORD_SVR_DVSN_CD: 'V' // Optional but often required for real trading
            };

            // Generate HashKey
            const hashkey = await this.getHashKey(data);
            if (hashkey) {
                headers['hashkey'] = hashkey;
            }

            logger.info(`[DEBUG] Cancel Request (TR_ID: ${trId}): ${JSON.stringify(data)}`);

            const response = await axios.post(`${this.baseUrl}/uapi/overseas-stock/v1/trading/order-rvsecncl`, data, { headers });

            logger.info(`Order Cancelled: ${symbol} (OrderNo: ${orderNo}) - Msg: ${response.data.msg1}`);
            return response.data;
        } catch (error) {
            if (error.response) {
                logger.error(`Cancel Error (${symbol}): Status ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                logger.error(`Cancel Error (${symbol}): ${error.message}`);
            }
            return null;
        }
    }
}

module.exports = new KisApi();
