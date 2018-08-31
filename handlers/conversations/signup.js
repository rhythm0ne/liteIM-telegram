const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const PhoneNumberValidator = require('../../utils/validators/phoneNumber')
const Responder = require('../../utils/responder')

const steps = ['email', 'phone', 'code']

const buttons = {
    cancel: { text: 'Cancel', callback_data: '/signup' }
}

const keyboards = {
    cancel: [buttons.cancel],
    begin: [{ text: 'Lets Begin!', callback_data: '/help' }],
    code: [
        { text: 'New Code', callback_data: '/requestNew2FACode phone' },
        buttons.cancel
    ],
    retry: [[{ text: 'Try Again', callback_data: '/signup' }]]
}

class SignupConvo {
    constructor(commandConvo) {
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
            message: this.responder.response('request', 'signup', 'email'),
            keyboard: keyboards.cancel
        }
    }

    async complete(value) {
        let telegramID = this.commandConvo.id
        let { email } = this.commandConvo.data()
        try {
            let address = await new ActionHandler().signup(telegramID, email, value)
            await this.firestore.updateIdOn2FA(telegramID)
            await this.firestore.clearCommandPartial(telegramID)
            return {
                message: this.responder.response('success', 'signup', null, { address }),
                keyboard: keyboards.begin
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
                    let emailExists = await this.firestore.checkIfEmailExists(value)
                    if (!emailExists){
                        return {
                            message: this.responder.response('request', 'signup', 'phone'),
                            keyboard: keyboards.cancel
                        }
                    } else {
                        //TODO: allow user to link this telegramID to the existing email address
                        await this.clearStep(step)
                        return {
                            message: this.responder.response('failure', 'firestore', 'emailExists'),
                            keyboard: keyboards.cancel
                        }
                    }
                } catch (err) {
                    await this.clearStep(step)
                    return {
                        message: err,
                        keyboard: keyboards.cancel
                    }
                }

            case steps[1]:
                try {
                    let number = (value.charAt(0) === '+') ? value.substr(1) : value
                    let numberExists = await this.firestore.checkIfPhoneNumberExists(number)
                    if (!numberExists) {
                        await new ActionHandler().enable2FA(telegramID, number)
                        return {
                            message: this.responder.response('request', 'signup', 'code', {number}),
                            keyboard: keyboards.code
                        }
                    } else {
                        await this.clearStep(step)
                        return {
                            message: this.responder.response('failure', 'twoFactor', 'numberInUse'),
                            keyboard: keyboards.cancel
                        }
                    }
                } catch (err) {
                    await this.clearStep(step)
                    return {
                        message: err,
                        keyboard: keyboards.cancel
                    }
                }

            case steps[2]:
                try {
                    await new ActionHandler().check2FA(telegramID, value)
                    return {
                        message: this.responder.response('request', 'signup', 'password'),
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
        if (!validated) throw {
            message: this.responder.response('failure', 'conversation', 'invalidStep', {step}),
            keyboard: keyboards.cancel
        }
        let params = {}
        params[step] = value
        try {
            await this.firestore.setCommandPartial(this.commandConvo.id, params)
            return await this.afterMessageForStep(step, value)
        } catch (err) {
            throw {
                message: err,
                keyboard: keyboards.cancel
            }
        }
    }

    async validateStep(step, value) {
        let telegramID = this.commandConvo.id
        switch (step) {
            case steps[0]:
                await this.firestore.unsetPartial2FA(telegramID)
                return new ActionHandler().isEmail(value)
            case steps[1]:
                await this.firestore.unsetPartial2FA(telegramID)
                return new PhoneNumberValidator(value).validate()
            case steps[2]:
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
