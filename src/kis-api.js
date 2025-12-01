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
                CTX_AREA_FK100: '',
                CTX_AREA_NK100: ''
            };

            const response = await axios.get(`${this.baseUrl}/uapi/overseas-stock/v1/trading/inquire-balance`, {
                headers,
                params
            });

            return response.data;
        } catch (error) {
            logger.error(`Get Balance Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Place Order
     * @param {string} symbol 
     * @param {string} side 'BUY' or 'SELL'
     * @param {number} qty 
     * @param {number} price (0 for market price if supported, but usually limit for overseas)
     */
    async placeOrder(symbol, side, qty, price) {
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
                OVRS_EXCG_CD: 'NASD', // Simplified: assuming Nasdaq for now. Logic needed to map symbol to exchange.
                PDNO: symbol,
                ORD_QTY: String(qty),
                OVRS_ORD_UNPR: String(price),
                ORD_SVR_DVSN_CD: '0',
                ORD_DVSN: '00' // Limit order
            };

            const response = await axios.post(`${this.baseUrl}/uapi/overseas-stock/v1/trading/order`, data, { headers });

            logger.info(`Order Placed: ${side} ${symbol} ${qty} @ ${price} - Msg: ${response.data.msg1}`);
            return response.data;
        } catch (error) {
            logger.error(`Order Error (${side} ${symbol}): ${error.message}`);
            return null;
        }
    }
}

module.exports = new KisApi();
