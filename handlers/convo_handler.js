const Firestore = require('./firestore_handler')

class ConvoHandler {
    constructor(telegramID) {
        this.telegramID = telegramID.toString()
        this.firestore = new Firestore()
    }

    async createNewCommandPartial(command) {
        await this.firestore.clearCommandPartial(this.telegramID)
        await this.firestore.addCommandPartial(this.telegramID, command)
    }

    async fetchCommandPartial() {
        return await this.firestore.fetchCommandPartial(this.telegramID)
    }
}

module.exports = ConvoHandler
