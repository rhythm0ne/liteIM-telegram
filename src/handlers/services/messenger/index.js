const request = require('request')

const serviceOptions = {
    keyboardSupport: true,
    htmlSupport: false,
    characterLimit: true,
    transactionLimit: 1
}

const sendMessage = (to, body, buttons = []) => {
    let messageData = { text: body }
    if (buttons && Array.isArray(buttons) && buttons.length > 0) messageData.quick_replies = buttons

    return request(
        {
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {
                access_token:
                    process.env.FACEBOOK_MESSENGER_TOKEN
            },
            method: 'POST',
            json: {
                recipient: { id: to },
                message: messageData
            }
        },
        (error, response, body) => {
            if (error) {
                console.log('Sending error:', error)
            }
        }
    )
}

const generateTextSuggestions = (success, isUser, res) => {
    let keyboards = require('../../keyboards')
    let keyboard = keyboards.getKeyboard(
        success,
        res.locals.command,
        res.locals.step,
        isUser,
        {},
        true
    )

    let buttons = []
    keyboard.forEach(button => {
        buttons.push({
            content_type: 'text',
            title: button.text,
            payload: button.callback_data
        })
    })

    return buttons
}

const middleware = async (req, res) => {
    res.submit = async (success, content, extraData = {}, notifier = {}) => {
        let isUser = false
        if (res.locals.user) isUser = true

        // let menu = await require('../../menu_handler')(success, isUser, res)
        let menu = generateTextSuggestions(success, isUser, res)

        if (Object.keys(extraData).length > 0 && extraData._type !== 'image') {
            for (let key in extraData) {
                if (!extraData.hasOwnProperty(key)) continue

                if (Array.isArray(extraData[key])) {
                    extraData[key].forEach(datum => {
                        if (datum.url) {
                            content += `\n\n${datum.url}`
                        }
                    })
                } else {
                    if (extraData[key].url) {
                        content += `\n\n${extraData[key].url}`
                    }
                }
            }
        }

        if (Object.keys(notifier).length > 0) {
            let { address, sender, txid, amount } = notifier
            const notifierHandler = require('../../notifier')
            await notifierHandler({ address, sender, txid, amount })
        }

        // if (menu && menu.length > 0) content += menu
        await sendMessage(res.locals.serviceID, content, menu)
        return res.send({ success: true })
    }

    try {
        let messaging_events = req.body.entry[0].messaging
        let event = messaging_events[0]
        if (!event) return { success: false, error: 'no message available' }
        if (!event.message || !event.message.text)
            return { success: false, error: 'Invalid message' }

        let sender = event.sender.id

        // "inject" the userId & body into the locals.
        res.locals.serviceOptions = serviceOptions
        res.locals.serviceID = sender // User's phone number
        res.locals.message = event.message.quick_reply
            ? event.message.quick_reply.payload
            : event.message.text // The message.

        return { success: true }
    } catch (e) {
        console.error('Error in messenger parsers:', e)
        return { success: false, error: e.message || e.toString() }
    }
}

const notifier = async (user, sender, txid, amount, url) => {
    let serviceID = user.services.messenger
    if (serviceID) {
        const Responder = require('../../responder')
        let responder = new Responder(serviceOptions)
        let message = responder.response('success', 'send', 'recipient', {
            amount,
            username: sender
        })
        message += '\n\n' + url

        await sendMessage(serviceID, message)
    }
}

module.exports = { middleware, sendMessage, notifier }
