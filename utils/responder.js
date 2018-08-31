
class Responder {
    constructor() {
        let lang = 'en'
        this.lang = require(`../languages/${lang}.json`)
        this.emojis = require(`../languages/emojis.json`)
    }

    response(type, scope, specification = null, context = null) {
        try {
            let response
            let responses = specification ? this.lang[type][scope][specification] : this.lang[type][scope]
            if (Array.isArray(responses)) {
                if (responses.length > 1) {
                    let rnd = Math.floor(Math.random() * responses.length)
                    response = responses[rnd]
                } else response = responses[0]
            } else response = responses

            if (context) {
                for (let key in context) {
                    if (context.hasOwnProperty(key)) {
                        let field = key
                        let value = context[key]
                        response = response.replace('${' + field + '}', value)
                    }
                }
            }

            let emojis = this.emojis[type]
            let rnd = Math.floor(Math.random() * (emojis.length * 2)) //this gives us a 50% chance of having an emoji
            let emoji = emojis[rnd] ? emojis[rnd] : ''

            return `${response} ${emoji}`
        } catch (err) {
            console.log(err)
            throw err
        }
    }
}

module.exports = Responder
