const TelegramMessenger = require('../utils/telegram')
const ConvoHandler = require('./convo_handler')
const Firestore = require('./firestore_handler')
const ActionHandler = require('./action_handler')
const SendConvo = require('./conversations/send')
const SignupConvo = require('./conversations/signup')
const ExportConvo = require('./conversations/export')
const Enable2FAConvo = require('./conversations/enable2FA')
const ChangeEmailConvo = require('./conversations/changeEmail')
const ChangePasswordConvo = require('./conversations/changePassword')

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

    let parsedMessage = parseParams(messageContent)
    if (!parsedMessage) return doConversation(webhookData)

    let actionHandler = new ActionHandler()
    await actionHandler.sync(telegramID).catch(failure => {
        console.log(`sync: ${failure}`) //ignore sync failure
    })

    if (
        (await actionHandler.isUserWithout2FA(telegramID)) &&
        parsedMessage.command !== '/requestNew2FACode'
    ) {
        parsedMessage.command = '/enable2fa'
    }

    let content, keyboard

    // start
    if (parsedMessage.command === '/start') {
        try {
            await new Firestore().fetchTelegramUser(telegramID)
            content = 'Hey there, good to see you again. What would you like to do?'
            keyboard = 'p1'
        } catch (_) {
            content = 'Hi there! Please click Register to begin.'
            keyboard = [{ text: 'Register', callback_data: '/signup' }]
        }
    }
    // help
    else if (parsedMessage.command === '/help') {
        content = 'What would you like to do?'
        keyboard = 'p1'
    }
    // receive
    else if (parsedMessage.command === '/receive') {
        let type = parsedMessage.params[0] ? parsedMessage.params[0] : null
        if (!type) {
            content = `Would you like to see your Litecoin wallet address, a QR code, or your registered email address?`
            keyboard = [
                [
                    { text: 'Wallet', callback_data: '/receive wallet' },
                    { text: 'QR', callback_data: '/receive qr' },
                    { text: 'Email', callback_data: '/receive email' }
                ],
                [{ text: 'Cancel', callback_data: '/help' }]
            ]
        } else {
            await actionHandler
                .receive(telegramID)
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
                    content = `I had a problem looking up your receiving addresses. Please try again, sorry about that. 😔`
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
                let data = await new SendConvo().initialMessage(telegramID)
                content = data
                if (data.keyboard) {
                    keyboard = data.keyboard
                    content = data.message
                }
            })
            .catch(async failure => {
                console.log(failure)
                content = 'An error occurred, please try again.'
                keyboard = 'p1'
            })
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
                console.log(failure)
                content = 'An error occurred, please try again.'
                keyboard = [[{ text: 'Signup', callback_data: '/signup' }]]
            })
    }
    // balance
    else if (parsedMessage.command === '/balance') {
        await actionHandler
            .balance(telegramID)
            .then(async balance => {
                try {
                    let rate = await require('../utils/getPrice')()
                    if (balance.unconfirmedBalance) {
                        content = `Your balance is ${
                            balance.balance
                        } LTC, and your unconfirmed balance is ${
                            balance.unconfirmedBalance
                        } LTC.`

                        if (rate) {
                            let balanceUSD = (
                                Number(balance.balance) * rate
                            ).toFixed(2)
                            let unconfirmedUSD = (
                                Number(balance.unconfirmedBalance) * rate
                            ).toFixed(2)

                            content = `Your balance is ${
                                balance.balance
                            } LTC or $${balanceUSD}, and your unconfirmed balance is ${
                                balance.unconfirmedBalance
                            } LTC or $${unconfirmedUSD}.`
                        }
                    } else {
                        content = `Your balance is ${balance.balance} LTC.`

                        if (rate) {
                            let balanceUSD = (
                                Number(balance.balance) * rate
                            ).toFixed(2)
                            content = `Your balance is ${
                                balance.balance
                            } LTC or $${balanceUSD}.`
                        }
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
                let data = await new ChangePasswordConvo().initialMessage(telegramID)
                content = data
                if (data.keyboard) {
                    keyboard = data.keyboard
                    content = data.message
                }
            })
            .catch(async failure => {
                console.log(failure)
                content = 'An error occurred, please try again.'
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
                console.log(failure)
                content = 'An error occurred, please try again.'
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
                console.log(failure)
                content = 'An error occurred, please try again.'
                keyboard = 'p1'
            })
    }
    // clear
    else if (parsedMessage.command === '/clear') {
        await actionHandler
            .clearCoversationCommand(telegramID)
            .then(async () => {
                content = 'Commands have been cleared.'
                keyboard = 'p1'
            })
            .catch(async failure => {
                content =
                    'There was a problem clearing your commands. Please try again.'
                keyboard = 'p1'
            })
    }
    // transactions
    else if (parsedMessage.command === '/transactions') {
        let startTime = !isNaN(parsedMessage.params[0])
            ? parsedMessage.params[0]
            : null
        await actionHandler
            .getTransactions(telegramID, startTime)
            .then(async data => {
                let { transactions, nextTime } = data
                if (startTime) {
                    content = `Here's a look at your next ${
                        transactions.length
                    } most recent transactions:`
                } else {
                    content = `Here's a look at your ${
                        transactions.length
                    } most recent transactions:`
                }

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

                if (nextTime) {
                    keyboard.push([
                        {
                            text: 'More...',
                            callback_data: `/transactions ${nextTime}`
                        },
                        { text: 'Back', callback_data: '/help' }
                    ])
                } else {
                    keyboard.push([{ text: 'Back', callback_data: '/help' }])
                }
            })
            .catch(async failure => {
                if (failure === 'No transactions found') {
                    content = `Hmm I didn't seem to find any transactions for you.`
                    keyboard = 'p1'
                } else {
                    content =
                        'There was a problem fetching your transactions. Please try again.'
                    keyboard = 'p1'
                }
            })
    }
    // enable2fa (only invoked by inline keyboard option)
    else if (parsedMessage.command === '/enable2fa') {
        await new ConvoHandler(telegramID)
            .createNewCommandPartial(parsedMessage.command)
            .then(async () => {
                content = new Enable2FAConvo().initialMessage()
            })
            .catch(async failure => {
                console.log(failure)
                content = 'An error occurred, please try again.'
                keyboard = [
                    [
                        {
                            text: 'Enable Two Factor Auth',
                            callback_data: '/enable2fa'
                        }
                    ]
                ]
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

                    return doConversation(webhookData)
                } else {
                    let command = convoPartial.data().command
                    if (inputType === 'message') webhookData.message.text = command
                    else webhookData.callback_query.data = command

                    return parseCommand(webhookData)
                }
            })
    } else if (parsedMessage.command === '/moreInlineCommands') {
        content = 'Here are some more commands you I can perform for you.'
        keyboard = 'p2'
    } else if (parsedMessage.command === '/mainInlineCommands') {
        content = 'What would you like to do?'
        keyboard = 'p1'
    }
    // Go process partial command
    else {
        return doConversation(webhookData)
    }

    //ensure there is always an inline keyboard
    if (!keyboard) {
        if (
            parsedMessage.command === '/signup' ||
            parsedMessage.command === '/start'
        ) {
            keyboard = [[{ text: 'Cancel', callback_data: '/start' }]]
        } else {
            keyboard = [[{ text: 'Cancel', callback_data: '/help' }]]
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

const doConversation = async webhookData => {
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
                    convo = new SendConvo(convoPartial, telegramUsername)
                    break
                case '/changePassword':
                    convo = new ChangePasswordConvo(convoPartial)
                    break
                case '/changeEmail':
                    convo = new ChangeEmailConvo(convoPartial)
                    break
                case '/export':
                    convo = new ExportConvo(convoPartial)
                    break
                case '/enable2fa':
                    convo = new Enable2FAConvo(convoPartial)
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
                        keyboard = [
                            {
                                text: 'Cancel',
                                callback_data: '/clear'
                            }
                        ]
                    }

                    if (data.alert) messenger.answerCallback(data.alert, true)
                })
                .catch(async failure => {
                    //TODO: check for start command here
                    content = failure
                    keyboard = [[{ text: 'Cancel', callback_data: '/help' }]]
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
                    keyboard = [[{ text: 'Cancel', callback_data: '/start' }]]
                } else {
                    keyboard = [[{ text: 'Cancel', callback_data: '/help' }]]
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
        "Sorry I didn't quite get that. Please cancel and try again.",
        messenger.inlineKeyboard([
            {
                text: 'Cancel',
                callback_data: '/help'
            }
        ])
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

// return an object { command: (String), params: (Object) }
function convertParsedParams(parsedParams, format) {
    if (!parsedParams) return
    let formattedParams = parseParams(format)
    if (
        !formattedParams ||
        formattedParams.command !== parsedParams.command ||
        formattedParams.params.length > parsedParams.params.length
    )
        return
    let paramHash = {}
    formattedParams.params.forEach((param, index) => {
        paramHash[param] = parsedParams.params[index]
    })
    formattedParams.params = paramHash
    return formattedParams
}

// Holds the format of the command expected from telegram users
const commandFormats = {
    signup: '/signup email password',
    balance: '/balance',
    receive: '/receive',
    send: '/send to amount password',
    changePassword: '/changePassword oldPassword newPassword',
    sync: '/sync',
    changeEmail: '/changeEmail newEmail password',
    export: '/export type password',
    transactions: '/transactions',
    import: '/import privateKey password', //TODO: implement this command; need to test multi wallet workflow
    help: '/help',
    clear: '/clear'
}

module.exports = parseCommand
