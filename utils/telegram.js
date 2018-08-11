const TelegramBot = require('./telegram_bot')
const Firestore = require('../handlers/firestore_handler')

class TelegramMessenger {
    constructor(data) {
        let { chatID, messageID, callbackID, fromID } = data

        this.chatID = chatID
        this.messageID = messageID
        this.callbackID = callbackID
        this.fromID = fromID
        this.bot = new TelegramBot()
    }

    // send message to telegram user
    async sendMessage(text, opts = {}) {
        opts.parse_mode = 'html'
        await this.bot
            .sendMessage(this.chatID, text, opts)
            .then(async success => {
                // console.log("OUT:")
                // console.log(success)
                await new Firestore().setBotMessageID(
                    this.fromID,
                    success.message_id
                )
            })
            .catch(failure => {
                console.log(`Error sending message to ${this.chatID}`, failure)
            })
    }

    async sendPhoto(url, caption, opts = {}) {
        if (caption) opts.caption = caption
        await this.bot
            .sendPhoto(this.chatID, url, opts)
            .then(async success => {
                await new Firestore().setBotMessageID(
                    this.fromID,
                    success.message_id
                )
            })
            .catch(failure => {
                console.log(`Error sending message to ${this.chatID}`, failure)
            })
    }

    async editMessage(text, opts = {}) {
        let messageID = this.messageID
        if (!messageID) {
            let messageIdToEdit = await new Firestore().getBotMessageID(this.fromID)
            messageID = messageIdToEdit.messageID
        }

        opts.parse_mode = 'html'
        await this.bot
            .editMessageText(this.chatID, messageID, text, opts)
            .then(success => {
                // console.log("OUT:")
                // console.log(success)
            })
            .catch(failure => {
                console.log(
                    `Error editing message to ${this.chatID}, message: ${messageID}`,
                    failure
                )
                throw 'Could not edit message.'
            })
    }

    async deleteMessage(chatId, messageId) {
        await this.bot.deleteMessage(chatId, messageId).then(() => {})
    }

    async answerCallback(text, alert = null, extra = null) {
        let callbackID = this.callbackID
        if (!callbackID) {
            let telegramUserDoc = await new Firestore().fetchTelegramUser(
                this.fromID
            )
            callbackID = telegramUserDoc.data().callbackID
        }

        await this.bot
            .answerCallback(callbackID, text, alert, extra)
            .then(success => {
                console.log(`Sent callback response to ${this.chatID}`)
            })
            .catch(failure => {
                console.log(
                    `Error sending callback response to ${this.chatID}`,
                    failure
                )
            })
    }

    inlineKeyboard(buttonLayout) {
        if (buttonLayout) {
            if (buttonLayout === 'p1') {
                buttonLayout = [
                    [
                        { text: 'Send', callback_data: '/send' },
                        { text: 'Receive', callback_data: '/receive' }
                    ],
                    [
                        { text: 'Show Balance', callback_data: '/balance' },
                        { text: 'Transactions', callback_data: '/transactions' }
                    ],
                    [{ text: 'More...', callback_data: '/moreInlineCommands' }]
                ]
            } else if (buttonLayout === 'p2') {
                buttonLayout = [
                    [
                        {
                            text: 'Change Password',
                            callback_data: '/changePassword'
                        },
                        { text: 'Change Email', callback_data: '/changeEmail' }
                    ],
                    [
                        { text: 'Export Wallet', callback_data: '/export' },
                        { text: 'Start New Chat', callback_data: '/start' }
                    ],
                    [{ text: 'Back', callback_data: '/mainInlineCommands' }]
                ]
            }

            return this.bot.Markup.inlineKeyboard(buttonLayout).extra()
        } else {
            return []
        }
    }
}

module.exports = TelegramMessenger
