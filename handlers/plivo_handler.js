const Plivo = require('plivo')

class PlivoHandler {
    constructor() {
        this.client = new Plivo.Client(
            process.env.PLIVO_AUTH_ID,
            process.env.PLIVO_AUTH_TOKEN
        )
    }

    send(to, message) {
        return this.client.messages
            .create(
                process.env.PLIVO_FROM_NUMBER,
                `+${to}`,
                message
            )
    }
}

module.exports = PlivoHandler