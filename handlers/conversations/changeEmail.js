const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const Responder = require('../../utils/responder')

const steps = ['newEmail', 'code']

const buttons = {
    cancel: { text: 'Cancel', callback_data: '/clear' }
}


const keyboards = {
    cancel: [buttons.cancel],
    code: [
        { text: 'New Code', callback_data: '/requestNew2FACode newEmail' },
        buttons.cancel
    ]
}

class ChangeEmailConvo {
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
            message: this.responder.response('request', 'changeEmail', 'newEmail'),
            keyboard: keyboards.cancel
        }
    }

    async complete(value) {
        let telegramID = this.commandConvo.id
        let { newEmail } = this.commandConvo.data()
        try {
            await new ActionHandler().changeEmail(this.user, newEmail, value)
            await this.firestore.clearCommandPartial(telegramID)
            return {
                message: this.responder.response('success', 'changeEmail', null, { newEmail }),
                keyboard: 'p1'
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
                try {
                    let emailExists = await this.firestore.checkIfEmailExists(value)
                    if (!emailExists) {
                        await new ActionHandler().request2FA(this.user.id)
                        return {
                            message: this.responder.response('request', 'changeEmail', 'code'),
                            keyboard: keyboards.code
                        }
                    } else {
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
                    await new ActionHandler().check2FA(telegramID, value, this.user.id)
                    let newEmail = this.commandConvo.data().newEmail
                    return {
                        message: this.responder.response('request', 'changeEmail', 'password', { newEmail }),
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
                return new ActionHandler().isEmail(value)
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

module.exports = ChangeEmailConvo
