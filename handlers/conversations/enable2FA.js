const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const Responder = require('../../utils/responder')
const PhoneNumberValidator = require('../../utils/validators/phoneNumber')

const steps = ['number', 'code']

const keyboards = {
    cancel: [{ text: 'Cancel', callback_data: '/enable2fa' }],
    code: [
        { text: 'New Code', callback_data: '/requestNew2FACode newEmail' }
    ],
    code2: [
        { text: 'Change Number', callback_data: '/enable2fa' },
        { text: 'New Code', callback_data: '/requestNew2FACode number' }
    ],
    retry: [[{ text: 'Try Again', callback_data: '/enable2fa' }]]
}

class SignupConvo {
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
            message: this.responder.response('request', 'enable2FA', 'number'),
            keyboard: []
        }
    }

    async complete(value) {
        let telegramID = this.commandConvo.id

        try {
            await new ActionHandler().checkPassword(this.user.email, value)
            await this.firestore.updateIdOn2FA(telegramID)
            await this.firestore.clearCommandPartial(telegramID)
            return {
                message: this.responder.response('success', 'enable2fa'),
                keyboard: 'p1'
            }
        } catch (err) {
            return {
                message: err,
                keyboard: keyboards.retry
            }
        }
    }

    async afterMessageForStep(step, value) {
        let telegramID = this.commandConvo.id
        switch (step) {
            case steps[0]:
                try {
                    let number = (value.charAt(0) === '+') ? value.substr(1) : value
                    await this.firestore.checkIfPhoneNumberExists(number)
                    await new ActionHandler().enable2FA(telegramID, number)
                    return {
                        message: this.responder.response('request', 'enable2FA', 'code', { number }),
                        keyboard: keyboards.code2
                    }
                } catch (err) {
                    return {
                        message: err,
                        keyboard: keyboards.retry
                    }
                }

            case steps[1]:
                try {
                    await new ActionHandler().check2FA(telegramID, value)
                    return {
                        message: this.responder.response('request', 'enable2FA', 'password'),
                        keyboard: keyboards.cancel
                    }
                } catch (err) {
                    await this.clearStep(step)
                    return {
                        message: err,
                        keyboard: keyboards.code2
                    }
                }

            default:
                return {
                    message: this.responder.response('failure', 'conversation', 'unexpectedInput'),
                    keyboard: keyboards.retry
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
            return await this.afterMessageForStep(step, value)
        } catch (err) {
            throw error
        }
    }

    async validateStep(step, value) {
        switch (step) {
            case steps[0]:
                await this.firestore.unsetPartial2FA(
                    this.commandConvo.id
                )
                return new PhoneNumberValidator(value).validate()
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

module.exports = SignupConvo
