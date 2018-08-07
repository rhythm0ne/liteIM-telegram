const commandResponder = require('./commands')

module.exports.webhook = async (event, context, callback) => {
    let response = {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        }
    }

    if (event.ping) {
        response.body = {"success": true}
        context.succeed(response)
    }

    let webhookData = JSON.parse(event.body)
    let commandResult = await commandResponder(webhookData)
    let success = !!commandResult

    response.body = JSON.stringify({ success })
    context.succeed(response)
}
