const axios = require('axios')

let baseURL = process.env.DEV_URL
if (process.env.STAGE === 'production') {
    baseURL = process.env.PROD_URL
} else if (process.env.STAGE === 'staging') {
    baseURL = process.env.STAGING_URL
}

class LtcApi {
    constructor(token) {
        let headers = {}
        if (token) headers = { Authorization: 'Bearer ' + token }
        this.handler = axios.create({
            baseURL,
            headers,
            transformRequest: [
                (data, headers) => {
                    if (!data) data = {}
                    data.network = 'ltc'
                    return JSON.stringify(data)
                }
            ]
        })
    }

    // LTC

    syncTransactions(userId) {
        return this.handler.post('/transaction-sync', { userId })
    }

    transferLtc(to, amount, currentPassword, from, interfaceMockId, toEmail = null) {
        let params = { to, amount, currentPassword, from, interfaceMockId, toEmail }
        return this.handler.post('/transaction-send', params)
    }

    // User

    changePassword(currentPassword, newPassword) {
        return this.handler.post('/change-password', { currentPassword, newPassword })
    }

    changeEmail(email, currentPassword) {
        return this.handler.post('/change-email', { email, currentPassword })
    }

    // Wallet

    createWallet(currentPassword) {
        return this.handler.post('/create-new-wallet', { currentPassword })
    }

    exportPrivateKey(currentPassword, wallet) {
        return this.handler.post('/reveal-private-key', {
            currentPassword,
            wallet
        })
    }

    exportMnemonic(currentPassword) {
        return this.handler.post('/reveal-mnemonic', {
            currentPassword
        })
    }

    getBalance(address) {
        return this.handler.post(`/get-balance`, { address })
    }

    async getEncryptionKey() {
        return this.handler.post('/request-encryption-key')
    }

    // Two Factor Authentication

    async enable2FA(phone, currentPassword) {
        return this.handler.post('/sms-auth-enable', {
            currentPassword,
            phone
        })
    }

    async request2FA(userId, identifier) {
        return this.handler.post('/sms-auth-request', {
            userId,
            identifier,
            actionType: 'auth'
        })
    }

    async check2FA(code) {
        return this.handler.post('/sms-auth-confirm', { code })
    }

    //not yet implemented
    importPrivateKey(privateKeyWIF, currentPassword) {
        return this.handler.post('ltc-import-existing-wallet', {
            privateKeyWIF,
            currentPassword
        })
    }

    // need to create lambda endpoint for this, but right now multi-wallet support is turned off
    /*setDefaultAddress(address) {
    return this.handler.post(`/wallet/${address}/default`);
  }*/

    // when we enable multi-wallet support i will need to make a lambda endpoint for this
    /*getTotalBalance() {
    return this.handler.post('wallet/balance');
  }*/
}

module.exports = LtcApi
