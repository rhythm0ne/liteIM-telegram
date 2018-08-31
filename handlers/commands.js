const TelegramMessenger = require('../utils/telegram')
const Responder = require('../utils/responder')
const ConvoHandler = require('./convo_handler')
const Firestore = require('./firestore_handler')
const ActionHandler = require('./action_handler')
const SendConvo = require('./conversations/send')
const SignupConvo = require('./conversations/signup')
const ExportConvo = require('./conversations/export')
const Enable2FAConvo = require('./conversations/enable2FA')
const ChangeEmailConvo = require('./conversations/changeEmail')
const ChangePasswordConvo = require('./conversations/changePassword')

const responder = new Responder()

const buttons = {
    cancel: { text: 'Cancel', callback_data: '/help' },
    back: { text: 'Back', callback_data: '/help' }
}

const keyboards = {
    register: [{ text: 'Register', callback_data: '/signup' }],
    receive: [
        [
            { text: 'Wallet', callback_data: '/receive wallet' },
            { text: 'QR', callback_data: '/receive qr' },
            { text: 'Email', callback_data: '/receive email' }
        ],
        [buttons.cancel]
    ],
    enable2fa: [{ text: 'Enable Two Factor Auth', callback_data: '/enable2fa' }],
    start: [[{ text: 'Cancel', callback_data: '/start' }]],
    cancel: [buttons.cancel],
    clear: [{ text: 'Cancel', callback_data: '/clear' }]
}

const parseCommand = async webhookData => {
    // console.log("IN:")
    // console.log(webhookData)

    if (!isValidRequest(webhookData)) return false
    let inputType, message, messageContent, chatID, messageID, callbackID
    if (webhookData.message) {
        inputType = 'message'
        message = webhookData.message
        messageContent = message.text
        chatID = message.chat.id
    } else {
        inputType = 'callback'
        message = webhookData.callback_query
        messageContent = message.data
        messageID = message.message.message_id
        chatID = message.from.id
        callbackID = message.id
    }

    let telegramID = message.from.id
    let messenger = new TelegramMessenger({
        chatID,
        messageID,
        callbackID,
        fromID: telegramID
    })

    let actionHandler = new ActionHandler()
    const user = await actionHandler.getUserFromTelegramID(telegramID)

    let parsedMessage = parseParams(messageContent)
    if (!parsedMessage) return doConversation(webhookData, user)

    if (user) {
        if (await actionHandler.isUserWithout2FA(user.id) && parsedMessage.command !== '/requestNew2FACode')
            parsedMessage.command = '/enable2fa'
    } else {
        if (parsedMessage.command !== '/start' &&
            parsedMessage.command !== '/signup' &&
            parsedMessage.command !== '/requestNew2FACode') {
                parsedMessage.command = '/start'
        }
    }

    let content, keyboard

    // start
    if (parsedMessage.command === '/start') {
        if (user) {
            content = responder.response('success', 'start', 'welcomeBack')
            keyboard = 'p1'
        } else {
            content = responder.response('success', 'start', 'welcome')
            keyboard = keyboards.register
        }
    }
    // signup
    else if (parsedMessage.command === '/signup') {
        await new ConvoHandler(telegramID)
            .createNewCommandPartial(parsedMessage.command)
            .then(async () => {
                let data = new SignupConvo().initialMessage()
                content = data
                if (data.keyboard) {
                    keyboard = data.keyboard
                    content = data.message
                }
            })
            .catch(async failure => {
                content = failure
                keyboard = keyboards.register
            })
    }
    // help
    else if (parsedMessage.command === '/help') {
        content = responder.response('request', 'help')
        keyboard = 'p1'
    }
    // receive
    else if (parsedMessage.command === '/receive') {
        let type = parsedMessage.params[0] ? parsedMessage.params[0] : null
        if (!type) {
            content = responder.response('request', 'receive')
            keyboard = keyboards.receive
        } else {
            await actionHandler
                .receive(user)
                .then(async addresses => {
                    let { wallet, email } = addresses
                    if (type === 'wallet') {
                        content = wallet.toString()
                        keyboard = 'p1'
                    } else if (type === 'qr') {
                        let address = wallet.toString()
                        let url = `https://chart.googleapis.com/chart?chs=250x250&cht=qr&chl=litecoin:${address}`

                        try {
                            let messageIdToDelete = await new Firestore().getBotMessageID(
                                telegramID
                            )
                            if (messageIdToDelete.messageID)
                                await messenger.deleteMessage(
                                    chatID,
                                    messageIdToDelete.messageID
                                )
                        } catch (err) {
                            console.log(
                                `Could not delete prior message. Error: ${err}`
                            )
                        }
                        await messenger.sendPhoto(
                            url,
                            address,
                            messenger.inlineKeyboard('p1')
                        )
                    } else if (type === 'email') {
                        content = email.toString()
                        keyboard = 'p1'
                    }
                })
                .catch(async failure => {
                    console.log(failure)
                    content = failure
                    keyboard = 'p1'
                })

            if (type === 'qr') return true
        }
    }
    // send
    else if (parsedMessage.command === '/send') {
        await new ConvoHandler(telegramID)
            .createNewCommandPartial(parsedMessage.command)
            .then(async () => {
                let data = await new SendConvo().initialMessage(user.id)
                content = data
                if (data.keyboard) {
                    keyboard = data.keyboard
                    content = data.message
                }
            })
            .catch(async failure => {
                content = failure
                keyboard = 'p1'
            })
    }
    // balance
    else if (parsedMessage.command === '/balance') {
        await actionHandler
            .balance(user.id)
            .then(async balance => {
                //TODO: extract this to an actionHandler method
                try {
                    let rate = await require('../utils/getPrice')()
                    if (rate) {
                        let balanceUSD = (
                            Number(balance) * rate
                        ).toFixed(2)
                        content = content = responder.response('success', 'balance', 'withoutUnconfirmedUSD', { balance, balanceUSD })
                    } else {
                        content = responder.response('success', 'balance', 'withoutUnconfirmed', { balance })
                    }
                    keyboard = 'p1'
                } catch (err) {
                    console.log(err) //ignore error fetching the price, we just won't use it
                }
            })
            .catch(async failure => {
                content = failure
                keyboard = 'p1'
            })
    }
    // changePassword
    else if (parsedMessage.command === '/changePassword') {
        await new ConvoHandler(telegramID)
            .createNewCommandPartial(parsedMessage.command)
            .then(async () => {
                let data = await new ChangePasswordConvo().initialMessage(user.id)
                content = data
                if (data.keyboard) {
                    keyboard = data.keyboard
                    content = data.message
                }
            })
            .catch(async failure => {
                content = failure
                keyboard = 'p1'
            })
    }
    // changeEmail
    else if (parsedMessage.command === '/changeEmail') {
        await new ConvoHandler(telegramID)
            .createNewCommandPartial(parsedMessage.command)
            .then(async () => {
                let data = new ChangeEmailConvo().initialMessage()
                content = data
                if (data.keyboard) {
                    keyboard = data.keyboard
                    content = data.message
                }
            })
            .catch(async failure => {
                content = failure
                keyboard = 'p1'
            })
    }
    // export
    else if (parsedMessage.command === '/export') {
        await new ConvoHandler(telegramID)
            .createNewCommandPartial(parsedMessage.command)
            .then(async () => {
                let data = new ExportConvo().initialMessage()
                content = data
                if (data.keyboard) {
                    keyboard = data.keyboard
                    content = data.message
                }
            })
            .catch(async failure => {
                content = failure
                keyboard = 'p1'
            })
    }
    // clear
    else if (parsedMessage.command === '/clear') {
        await actionHandler
            .clearCoversationCommand(telegramID)
            .then(async () => {
                content = responder.response('success', 'clear')
                keyboard = 'p1'
            })
            .catch(async failure => {
                content = failure
                keyboard = 'p1'
            })
    }
    // transactions
    else if (parsedMessage.command === '/transactions') {
        let more = parsedMessage.params[0] === 'more'
        await actionHandler
            .getTransactions(user.id, more)
            .then(async data => {
                let { transactions, more } = data
                let moreThanOne = transactions.length > 1 ? transactions.length : ''
                content = responder.response('success', 'transactions', null, { moreThanOne })

                let subdomain =
                    process.env.STAGE === 'production' ||
                    process.env.STAGE === 'staging'
                        ? 'insight'
                        : 'testnet'

                let buttonLayout = []
                transactions.forEach(transaction => {
                    buttonLayout.push({
                        text: transaction.txid,
                        url: `https://${subdomain}.litecore.io/tx/${
                            transaction.txid
                        }/`
                    })
                })

                keyboard = [buttonLayout]

                if (more) {
                    keyboard.push([
                        {
                            text: 'More...',
                            callback_data: `/transactions more`
                        },
                        buttons.back
                    ])
                } else {
                    keyboard.push([buttons.back])
                }
            })
            .catch(async failure => {
                content = failure
                keyboard = 'p1'
            })
    }
    // enable2fa (only invoked by 2fa requirement check)
    else if (parsedMessage.command === '/enable2fa') {
        await new ConvoHandler(telegramID)
            .createNewCommandPartial(parsedMessage.command)
            .then(async () => {
                let data = new Enable2FAConvo().initialMessage()
                content = data
                if (data.keyboard) {
                    keyboard = data.keyboard
                    content = data.message
                }
            })
            .catch(async failure => {
                content = failure
                keyboard = keyboards.enable2fa
            })
    }
    // request new two factor authentication code to be sent
    else if (parsedMessage.command === '/requestNew2FACode') {
        return await new ConvoHandler(chatID)
            .fetchCommandPartial()
            .then(async convoPartial => {
                let step = parsedMessage.params[0] ? parsedMessage.params[0] : null
                if (step) {
                    let stepValue = convoPartial.data()[step]
                    let Firestore = require('./firestore_handler')
                    await new Firestore().unsetCommandPartial(convoPartial.id, step)

                    if (inputType === 'message') webhookData.message.text = stepValue
                    else webhookData.callback_query.data = stepValue

                    return doConversation(webhookData, user)
                } else {
                    let command = convoPartial.data().command

                    if (inputType === 'message') webhookData.message.text = command
                    else webhookData.callback_query.data = command

                    return parseCommand(webhookData)
                }
            })
    } else if (parsedMessage.command === '/moreInlineCommands') {
        content = responder.response('success', 'more')
        keyboard = 'p2'
    } else if (parsedMessage.command === '/mainInlineCommands') {
        content = responder.response('success', 'main')
        keyboard = 'p1'
    }
    // Go process partial command
    else {
        return doConversation(webhookData, user)
    }

    //ensure there is always an inline keyboard
    if (!keyboard) {
        if (
            parsedMessage.command === '/signup' ||
            parsedMessage.command === '/start'
        ) {
            keyboard = keyboards.start
        } else {
            keyboard = keyboards.cancel
        }
    }

    if (inputType === 'message') {
        try {
            let messageIdToEdit = await new Firestore().getBotMessageID(telegramID)
            if (messageIdToEdit.messageID)
                await messenger.deleteMessage(chatID, messageIdToEdit.messageID)
        } catch (err) {
            console.log(`Could not delete prior message. Error: ${err}`)
        }
        await messenger.sendMessage(content, messenger.inlineKeyboard(keyboard))
    } else if (inputType === 'callback')
        try {
            await messenger.editMessage(content, messenger.inlineKeyboard(keyboard))
        } catch (err) {
            console.log(`Failed to edit message with error: ${err}`)
            let messageIdToEdit = await new Firestore().getBotMessageID(telegramID)
            if (messageIdToEdit.messageID)
                await messenger.deleteMessage(chatID, messageIdToEdit.messageID)
            await messenger.sendMessage(content, messenger.inlineKeyboard(keyboard))
        }

    return true
}

const doConversation = async (webhookData, user) => {
    let inputType, message, messageContent, chatID, messageID, callbackID
    if (webhookData.message) {
        inputType = 'message'
        message = webhookData.message
        messageContent = message.text
        chatID = message.chat.id
        let Firestore = require('./firestore_handler')
        let fetchMessageIdToEdit = await new Firestore().getBotMessageID(chatID)
        messageID = fetchMessageIdToEdit.messageID
    } else {
        inputType = 'callback'
        message = webhookData.callback_query
        messageContent = message.data
        chatID = message.from.id
        callbackID = message.id
    }

    let telegramID = message.from.id
    let telegramUsername = message.from.username
    let messenger = new TelegramMessenger({
        chatID,
        messageID,
        callbackID,
        fromID: telegramID
    })

    let content, keyboard
    await new ConvoHandler(chatID)
        .fetchCommandPartial()
        .then(async convoPartial => {
            let convo
            switch (convoPartial.data().command) {
                case '/signup':
                    convo = new SignupConvo(convoPartial)
                    break
                case '/send':
                    convo = new SendConvo(convoPartial, user, telegramUsername)
                    break
                case '/changePassword':
                    convo = new ChangePasswordConvo(convoPartial, user)
                    break
                case '/changeEmail':
                    convo = new ChangeEmailConvo(convoPartial, user)
                    break
                case '/export':
                    convo = new ExportConvo(convoPartial, user)
                    break
                case '/enable2fa':
                    convo = new Enable2FAConvo(convoPartial, user)
                    break
                default:
                    return unknownMessage(messenger)
            }
            await convo
                .setCurrentStep(messageContent.trim())
                .then(async data => {
                    content = data
                    if (typeof data === 'object') {
                        content = data.message
                        keyboard = data.keyboard ? data.keyboard : []
                    } else {
                        keyboard = keyboards.clear
                    }

                    if (data.alert) await messenger.answerCallback(data.alert, true)
                })
                .catch(async failure => {
                    content = failure
                    keyboard = keyboards.cancel
                    if (failure.message) {
                        content = failure.message
                        keyboard = failure.keyboard
                    }
                })

            //ensure there is always an inline keyboard
            if (!keyboard) {
                if (
                    convoPartial.data().command === '/signup' ||
                    convoPartial.data().command === '/start'
                ) {
                    keyboard = keyboards.start
                } else {
                    keyboard = keyboards.cancel
                }
            }

            if (inputType === 'message') {
                try {
                    let messageIdToEdit = await new Firestore().getBotMessageID(
                        telegramID
                    )
                    if (messageIdToEdit.messageID)
                        await messenger.deleteMessage(
                            chatID,
                            messageIdToEdit.messageID
                        )
                } catch (err) {
                    console.log(`Could not delete prior message. Error: ${err}`)
                }
                await messenger.sendMessage(
                    content,
                    messenger.inlineKeyboard(keyboard)
                )
            } else if (inputType === 'callback')
                try {
                    await messenger.editMessage(
                        content,
                        messenger.inlineKeyboard(keyboard)
                    )
                } catch (_) {
                    let messageIdToEdit = await new Firestore().getBotMessageID(
                        telegramID
                    )
                    if (messageIdToEdit.messageID)
                        await messenger.deleteMessage(
                            chatID,
                            messageIdToEdit.messageID
                        )
                    await messenger.sendMessage(
                        content,
                        messenger.inlineKeyboard(keyboard)
                    )
                }

            return true
        })
        .catch(failure => {
            // Go process unknown command
            return unknownMessage(messenger)
        })
}

const unknownMessage = async messenger => {
    await messenger.editMessage(
        responder.response('failure', 'unknownInput'),
        messenger.inlineKeyboard(keyboards.cancel)
    )
    return true
}

function isValidRequest(req) {
    // TODO: change to use typeof
    return (
        req &&
        ((req.callback_query && req.callback_query.data) ||
            (req.message &&
                req.message.chat &&
                req.message.chat.id &&
                req.message.from &&
                req.message.from.id &&
                req.message.text))
    )
}

// return an object { command: (String), params: (Array) }
function parseParams(str) {
    if (typeof str !== 'string') return
    let params = str.split(/\s+/)
    params = params.filter(param => param.length > 0)
    if (params.length === 0) return
    let command = params.shift()
    if (!/^\/\S+/.test(command)) return
    return { command, params }
}

module.exports = parseCommand
