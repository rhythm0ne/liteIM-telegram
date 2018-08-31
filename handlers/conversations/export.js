const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const Responder = require('../../utils/responder')

const steps = ['type', 'code']

const buttons = {
    cancel: { text: 'Cancel', callback_data: '/clear' }
}

const keyboards = {
    main: [[{ text: 'Main Menu', callback_data: '/help' }]],
    cancel: [buttons.cancel],
    type: [
        [
            { text: '🗝 key', callback_data: 'key' },
            { text: '🔡 phrase', callback_data: 'phrase' }
        ],
        [buttons.cancel]
    ],
    code: [
        { text: 'New Code', callback_data: '/requestNew2FACode type' },
        buttons.cancel
    ]
}

class ExportConvo {
    constructor(commandConvo, user) {
        this.user = user
        this.commandConvo = commandConvo
        this.firestore = new Firestore()
        this.responder = new Responder()
    }

    currentStep() {
        for (let i = 0; i < steps.length; i++) {
            let step = steps[i]
            if (!this.commandConvo.data()[step]) return step
        }
    }

    initialMessage() {
        return {
            message: this.responder.response('request', 'export', 'type'),
            keyboard: keyboards.type
        }
    }

    async complete(value) {
        let telegramID = this.commandConvo.id
        let { type } = this.commandConvo.data()
        try {
            let secret = await new ActionHandler().export(this.user, type, value)
            await this.firestore.clearCommandPartial(telegramID)
            if (type === 'key')
                return {
                    message: `<pre>${secret}</pre>`,
                    keyboard: keyboards.main
                }
            else if (type === 'phrase')
                return {
                    message: `<pre>${secret}</pre>`,
                    keyboard: keyboards.main
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
            case steps[0]: //send 2fa code, and prompt user to enter it
                try {
                    await new ActionHandler().request2FA(this.user.id)
                    return {
                        message: this.responder.response('request', 'export', 'code'),
                        keyboard: keyboards.code
                    }
                } catch (err) {
                    await this.clearStep(step)
                    return {
                        message: err,
                        keyboard: keyboards.cancel
                    }
                }

            case steps[1]: //check 2fa code, and prompt user to enter password
                try {
                    await new ActionHandler().check2FA(telegramID, value, this.user.id)
                    return {
                        message: this.responder.response('request', 'export', 'password'),
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
        if (!validated) throw this.responder.response('failure', 'conversation', 'invalidStep', { step })
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
                return value === 'key' || value === 'phrase'
            case steps[1]:
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

module.exports = ExportConvo
