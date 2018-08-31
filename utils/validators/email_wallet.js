const Firestore = require('../../handlers/firestore_handler')
const Responder = require('../responder')

class EmailWalletValidator {
    constructor(email) {
        this.email = email
        this.firstore = new Firestore()
        this.responder = new Responder()
    }

    async validate() {
        if (!this.email) return false
        try {
            await this.firstore.fetchWalletByEmail(this.email)
            return true
        } catch (_) {
            throw this.responder.response('failure', 'send', 'emailNotRegistered', { email: this.email })
        }
    }
}

module.exports = EmailWalletValidator
