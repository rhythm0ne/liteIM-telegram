const commandResponder = require('./commands')

module.exports.webhook = async (event, context, callback) => {
    let webhookData = JSON.parse(event.body)
    let commandResult = await commandResponder(webhookData)
    let success = !!commandResult

    let response = {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        }
    }

    response.body = JSON.stringify({ success })
    context.succeed(response)
}
