const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const Responder = require('../../utils/responder')
const EmailWalletValidator = require('../../utils/validators/email_wallet')
const NumberValidator = require('../../utils/validators/number')

const steps = ['to', 'currency', 'amount', 'code']

const buttons = {
    cancel: { text: 'Cancel', callback_data: '/clear' }
}

const keyboards = {
    currency: [
        [{ text: '$', callback_data: '$' }, { text: 'Ł', callback_data: 'Ł' }],
        [buttons.cancel]
    ],
    cancel: [buttons.cancel],
    receive: [[
        { text: 'Receive', callback_data: '/receive' },
        buttons.cancel
    ]],
    amount: [[
        { text: 'Send All', callback_data: 'all' },
        buttons.cancel
    ]],
    code: [
        { text: 'New Code', callback_data: '/requestNew2FACode amount' },
        buttons.cancel
    ],
    main: { text: 'Main Menu', callback_data: '/help' }
}

class SendConvo {
    constructor(commandConvo, user, telegramUsername) {
        this.user = user
        this.commandConvo = commandConvo
        this.firestore = new Firestore()
        this.responder = new Responder()
        this.telegramUsername = telegramUsername
    }

    currentStep() {
        for (let i = 0; i < steps.length; i++) {
            let step = steps[i]
            if (!this.commandConvo.data()[step]) return step
        }
    }

    async initialMessage(userID) {
        let balance = await new ActionHandler().balance(userID)
        if (typeof balance !== undefined) {
            if (Number(balance) > 0) {
                return {
                    message: this.responder.response('request', 'send', 'to'),
                    keyboard: keyboards.cancel
                }
            } else
                return {
                    message: this.responder.response('failure', 'send', 'zeroBalance'),
                    keyboard: keyboards.receive
                }
        } else
            return {
                message: this.responder.response('failure', 'send', 'fetchBalance'),
                keyboard: keyboards.cancel
            }
    }

    async complete(value) {
        let telegramID = this.commandConvo.id
        let { to, amount } = this.commandConvo.data()

        try {
            let data = await new ActionHandler().send(to, amount, value, this.user)
            let { txid, toUser } = data

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
                keyboards.main
            ]

            if (toUser) {
                let TelegramMessenger = require('../../utils/telegram')
                let notifier = new TelegramMessenger({
                    chatID: toUser,
                    fromID: toUser
                })

                try {
                    let messageIdToDelete = await this.firestore.getBotMessageID(toUser)
                    if (messageIdToDelete.messageID)
                        await notifier.deleteMessage(
                            toUser,
                            messageIdToDelete.messageID
                        )
                } catch (err) {
                    console.log(`Could not delete prior message for tx notification. Error: ${err}`)
                }

                await notifier.sendMessage(
                    this.responder.response('success', 'send', 'recipient', { amount, username: this.telegramUsername }),
                    notifier.inlineKeyboard(keyboardLayout)
                )
            }

            await this.firestore.clearCommandPartial(telegramID)
            return {
                message: this.responder.response('success', 'send', 'sender'),
                keyboard: keyboardLayout
            }
        } catch (err) {
            return {
                message: err,
                keyboard: keyboards.cancel
            }
        }
    }

    async afterMessageForStep(step, value) {
        let telegramID = this.commandConvo.id
        switch (step) {
            case steps[0]:
                return {
                    message: this.responder.response('request', 'send', 'currency'),
                    keyboard: keyboards.currency
                }
            case steps[1]:
                let to = this.commandConvo.data().to
                let currency = value
                return {
                    message: this.responder.response('request', 'send', 'amount', { to, currency }),
                    keyboard: keyboards.amount
                }
            case steps[2]:
                let amount = value
                if (amount === 'all') {
                    let getBalance = await new ActionHandler().balance(this.user.id)
                    if (getBalance) {
                        let balance = Number(getBalance)
                        amount = balance

                        if (this.commandConvo.data().currency === '$') {
                            try {
                                let rate = await require('../../utils/getPrice')()
                                amount = (amount * rate).toFixed(2)
                            } catch (err) {
                                throw err
                            }
                        }
                    } else
                        return {
                            message: this.responder.response('failure', 'send', 'fetchBalance'),
                            keyboard: keyboards.cancel
                        }
                }

                if (this.commandConvo.data().currency === '$') {
                    if (typeof amount === 'string' && amount.charAt(0) === '$')
                        amount = amount.substr(1)
                    try {
                        let rate = await require('../../utils/getPrice')()
                        let amountLTC = (amount / rate).toFixed(4)
                        let params = {}
                        params['amount'] = amountLTC
                        await this.firestore.setCommandPartial(
                            this.commandConvo.id,
                            params
                        )
                    } catch (err) {
                        throw err
                    }
                }

                try {
                    await new ActionHandler().request2FA(this.user.id)

                    let message = amount === 'all' ?
                        this.responder.response('request', 'sendAll', 'code') :
                        this.responder.response('request', 'send', 'code')

                    return {
                        message,
                        keyboard: keyboards.code
                    }
                } catch (err) {
                    await this.clearStep(step)
                    return {
                        message: err,
                        keyboard: keyboards.cancel
                    }
                }
            case steps[3]:
                try {
                    await new ActionHandler().check2FA(telegramID, value, this.user.id)
                    let amount = this.commandConvo.data().amount
                    let to = this.commandConvo.data().to

                    if (amount !== 'all') amount = `Ł${amount}`

                    return {
                        message: this.responder.response('request', 'send', 'password', { amount, to }),
                        keyboard: keyboards.cancel
                    }
                } catch (err) {
                    await this.clearStep(step)
                    return {
                        message: err,
                        keyboard: keyboards.code
                    }
                }
            default:
                return {
                    message: this.responder.response('failure', 'conversation', 'unexpectedInput'),
                    keyboard: keyboards.cancel
                }
        }
    }

    async setCurrentStep(value) {
        let currentStep = this.currentStep()
        if (currentStep) {
            return await this.setStep(currentStep, value)
        } else {
            return await this.complete(value)
        }
    }

    async setStep(step, value) {
        let validated = await this.validateStep(step, value)
        if (!validated)
            throw {
                message: this.responder.response('failure', 'conversation', 'invalidStep', { step }),
                keyboard: keyboards[step]
            }
        let params = {}
        params[step] = value
        try {
            await this.firestore.setCommandPartial(this.commandConvo.id, params)
            return this.afterMessageForStep(step, value)
        } catch (err) {
            throw err
        }
    }

    async validateStep(step, value) {
        switch (step) {
            case steps[0]:
                let ah = new ActionHandler()
                if (ah.isEmail(value))
                    return await new EmailWalletValidator(value).validate()
                else return ah.isLitecoinAddress(value)
            case steps[1]:
                return value === '$' || value === 'Ł'
            case steps[2]:
                if (value === 'all') return true
                if (value.charAt(0) === '$') value = value.substr(1)
                return new NumberValidator(value).validate()
            case steps[3]:
                return true
            default:
                return false
        }
    }

    async clearStep(step) {
        await this.firestore.unsetCommandPartial(
            this.commandConvo.id,
            step
        )
    }
}

module.exports = SendConvo
