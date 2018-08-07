const Firestore = require('../../handlers/firestore_handler')

class EmailWalletValidator {
    constructor(email) {
        this.email = email
        this.firstore = new Firestore()
    }

    async validate() {
        if (!this.email) return false
        try {
            await this.firstore.fetchWalletByEmail(this.email)
            return true
        } catch (e) {
            return false
        }
    }
}

module.exports = EmailWalletValidator
