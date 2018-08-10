const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const EmailWalletValidator = require('../../utils/validators/email_wallet')
const NumberValidator = require('../../utils/validators/number')

const steps = ['to', 'currency', 'amount', 'code']

const keyboards = {
    currency: [
        [{ text: '$', callback_data: '$' }, { text: 'Ł', callback_data: 'Ł' }],
        [{ text: 'Cancel', callback_data: '/clear' }]
    ]
}

class SendConvo {
    constructor(commandConvo, telegramUsername) {
        this.commandConvo = commandConvo
        this.firestore = new Firestore()
        this.telegramUsername = telegramUsername
    }

    currentStep() {
        for (let i = 0; i < steps.length; i++) {
            let step = steps[i]
            if (!this.commandConvo.data()[step]) return step
        }
    }

    async initialMessage(telegramID) {
        let getBalance = await new ActionHandler().balance(
            telegramID
        )
        if (getBalance && getBalance.balance) {
            if (Number(getBalance.balance) > 0) {
                return {
                    message: 'Who would you like to send LTC to? You can send me a valid email address or a valid Litecoin address.',
                    keyboard: [[{text: 'Cancel', callback_data: '/clear'}]]
                }
            } else return {
                message: `You don't have any LTC to send silly! Click "Receive" to fund your Lite.IM wallet.`,
                keyboard: [[
                    {text: 'Receive', callback_data: '/receive'},
                    {text: 'Cancel', callback_data: '/clear'}
                ]]
            }
        } else return {
            message: 'I was unable to fetch your balance. Click "Cancel" to start over.',
            keyboard: [[{ text: 'Cancel', callback_data: '/clear' }]]
        }
    }

    async complete(value) {
        let { to, amount, telegramID } = this.commandConvo.data()

        try {
            let data = await new ActionHandler().send(to, amount, value, telegramID)
            let { txid, toUser } = data

            if (txid) {
                let subdomain =
                    process.env.STAGE === 'production' ||
                    process.env.STAGE === 'staging'
                        ? 'insight'
                        : 'testnet'

                let keyboardLayout = [
                    [
                        {
                            text: txid,
                            url: `https://${subdomain}.litecore.io/tx/${txid}/`
                        },
                        { text: 'Main Menu', callback_data: '/help' }
                    ]
                ]

                if (toUser) {
                    let TelegramMessenger = require('../../utils/telegram')
                    let notifier = new TelegramMessenger({
                        chatID: toUser,
                        fromID: toUser
                    })

                    try {
                        let messageIdToDelete = await this.firestore.getBotMessageID(
                            toUser
                        )
                        if (messageIdToDelete.messageID)
                            await notifier.deleteMessage(
                                toUser,
                                messageIdToDelete.messageID
                            )
                    } catch (err) {
                        console.log(`Could not delete prior message. Error: ${err}`)
                    }

                    notifier.sendMessage(
                        `You just received Ł${amount} from ${this.telegramUsername}`,
                        notifier.inlineKeyboard(keyboardLayout)
                    )
                }

                await this.firestore.clearCommandPartial(telegramID)

                return {
                    message:
                        `Transaction sent! Click below to see the transaction details. Please remember ` +
                        `to clear this conversation to remove sensitive information.`,
                    keyboard: keyboardLayout
                }
            } else {
                return {
                    message: `There was a problem with your transaction, please try again.`,
                    keyboard: [[{ text: 'Cancel', callback_data: '/clear' }]]
                }
            }
        } catch (e) {
            throw e.toString()
        }
    }

    async afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
                return {
                    message: `Would you prefer to express the amount in USD ($) or LTC (Ł)?`,
                    keyboard: keyboards['currency']
                }
            case steps[1]:
                return {
                    message:
                        `How much do you want to send to ${
                            this.commandConvo.data().to
                        }, expressed in ${value}? \n` + `Example: 1.50`,
                    keyboard: [
                        [
                            { text: 'Send All', callback_data: 'all' },
                            { text: 'Cancel', callback_data: '/clear' }
                        ]
                    ]
                }
            case steps[2]:
                let amount = value
                if (amount === 'all') {
                    let getBalance = await new ActionHandler().balance(
                        this.commandConvo.data().telegramID
                    )
                    if (getBalance && getBalance.balance) {
                        let balance = Number(getBalance.balance)
                        let unconfirmedBalance = Number(
                            getBalance.unconfirmedBalance
                        )

                        amount = balance
                        if (unconfirmedBalance > 0 && unconfirmedBalance < balance)
                            amount = unconfirmedBalance

                        let params = {}
                        params['amount'] = amount
                        await this.firestore.setCommandPartial(
                            this.commandConvo.id,
                            params
                        )

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
                            message:
                                'I was unable to fetch your balance. Click "Cancel" to start over.',
                            keyboard: [[{ text: 'Cancel', callback_data: '/clear' }]]
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

                let result = await new ActionHandler().request2FA(
                    this.commandConvo.data().telegramID
                )
                if (result)
                    return {
                        message: `Please enter the two factor authentication code you received via SMS.`,
                        keyboard: [
                            { text: 'New Code', callback_data: '/requestNew2FACode amount' },
                            { text: 'Cancel', callback_data: '/help' }
                        ]
                    }
                else {
                    await this.firestore.unsetCommandPartial(
                        this.commandConvo.id,
                        step
                    )
                    return {
                        message:
                            'Sorry, I had an issue with your request. Please try again.',
                        keyboard: [{ text: 'Cancel', callback_data: '/help' }]
                    }
                }
            case steps[3]:
                let checkCode = await new ActionHandler().check2FA(
                    this.commandConvo.data().telegramID,
                    value
                )

                if (checkCode)
                    return {
                        message: `If you want to send ${
                            this.commandConvo.data().currency
                        }${this.commandConvo.data().amount} to ${
                            this.commandConvo.data().to
                        } then please reply with your password so I can continue.`,
                        keyboard: [{ text: 'Cancel', callback_data: '/help' }]
                    }
                else {
                    await this.firestore.unsetCommandPartial(
                        this.commandConvo.id,
                        step
                    )
                    return {
                        message:
                            'You entered an invalid code, or the code we sent you has expired. Please try again.',
                        keyboard: [
                            { text: 'New Code', callback_data: '/requestNew2FACode amount' },
                            { text: 'Cancel', callback_data: '/help' }
                        ]
                    }
                }
            default:
                throw 'Not sure what to do here. Click "Cancel" to start over.'
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
                message: `Please enter a valid ${step}.`,
                keyboard: keyboards[step]
            }
        let params = {}
        params[step] = value
        try {
            await this.firestore.setCommandPartial(this.commandConvo.id, params)
            return this.afterMessageForStep(step, value)
        } catch (e) {
            console.log(e)
            throw `An error occurred, please try sending "${step}" again.`
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
}

module.exports = SendConvo
