const Firestore = require('./firestore_handler')
const TelegramMessenger = require('../utils/telegram')
const Responder = require('../utils/responder')

module.exports.handler = async (event, context, callback) => {
    let success
    try {
        let { address, sender, txid, amount } = JSON.parse(event.body)
        let firestore = new Firestore()

        let user = await firestore.fetchTelegramUserByAddress(address)
        let telegramID = user.telegramID

        let notifier = new TelegramMessenger({
            chatID: telegramID,
            fromID: telegramID
        })

        try {
            let messageIdToDelete = await firestore.getBotMessageID(telegramID)
            if (messageIdToDelete.messageID)
                await notifier.deleteMessage(
                    telegramID,
                    messageIdToDelete.messageID
                )
        } catch (err) {
            console.log(`Could not delete prior message for tx notification. Error: ${err}`)
        }

        let subdomain =
            process.env.STAGE === 'production' ||
            process.env.STAGE === 'staging'
                ? 'insight'
                : 'testnet'

        let keyboardLayout = [
            {
                text: txid,
                url: `https://${subdomain}.litecore.io/tx/${txid}/`
            },
            { text: 'Main Menu', callback_data: '/help' }
        ]

        let responder = new Responder()
        await notifier.sendMessage(
            responder.response('success', 'send', 'recipient', { amount, username: sender }),
            notifier.inlineKeyboard(keyboardLayout)
        )

        let success = true
    } catch (e) {
        console.log(e)
        success = false
    }

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
