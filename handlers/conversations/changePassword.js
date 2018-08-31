const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const Responder = require('../../utils/responder')

const steps = ['code']

const buttons = {
    cancel: { text: 'Cancel', callback_data: '/clear' }
}

const keyboards = {
    cancel: [buttons.cancel],
    code: [
        { text: 'New Code', callback_data: '/changePassword' },
        buttons.cancel
    ]
}

class ChangePasswordConvo {
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

    async initialMessage(userID) {
        try {
            await new ActionHandler().request2FA(userID)
            return {
                message: this.responder.response('request', 'changePassword', 'code'),
                keyboard: keyboards.code
            }
        } catch (err) {
            return {
                message: err,
                keyboard: keyboards.cancel
            }
        }
    }

    async complete(value) {
        let telegramID = this.commandConvo.id
        try {
            let params = value.split(/\s+/)
            params = params.filter(param => param.length > 0)
            if (params.length < 2)
                return {
                    message: this.responder.response('request', 'changePassword', 'password'),
                    keyboard: keyboards.cancel
                }

            let currentPassword = params[0]
            let newPassword = params[1]

            await new ActionHandler().changePassword(
                this.user,
                currentPassword,
                newPassword
            )
            await this.firestore.clearCommandPartial(telegramID)
            return {
                message: this.responder.response('success', 'changePassword', null, { newPassword }),
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
                    await new ActionHandler().check2FA(telegramID, value, this.user.id)
                    return {
                        message: this.responder.response('request', 'changePassword', 'password'),
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

module.exports = ChangePasswordConvo
