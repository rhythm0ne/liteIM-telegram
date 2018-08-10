const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')

const steps = ['code']

class ChangePasswordConvo {
    constructor(commandConvo) {
        this.commandConvo = commandConvo
        this.firestore = new Firestore()
    }

    currentStep() {
        for (let i = 0; i < steps.length; i++) {
            let step = steps[i]
            if (!this.commandConvo.data()[step]) return step
        }
    }

    async initialMessage(telegramID) {
        let result = await new ActionHandler().request2FA(telegramID)
        if (result) {
            return {
                message: `I see you'd like to change your password. Please enter the security code you just received via SMS.`,
                keyboard: [
                    {text: 'New Code', callback_data: '/requestNew2FACode'},
                    {text: 'Cancel', callback_data: '/clear'}
                ]
            }
        }
    }

    async complete(value) {
        let { telegramID } = this.commandConvo.data()
        try {
            let params = value.split(/\s+/)
            params = params.filter(param => param.length > 0)
            if (params.length < 2)
                return {
                    message:
                        `Please enter your current password followed by you new password, ` +
                        `each separated by a space, or click "Cancel". \n\nExample: yourPassword yourNewPassword`,
                    keyboard: [{ text: 'Cancel', callback_data: '/clear' }]
                }

            let currentPassword = params[0]
            let newPassword = params[1]

            await new ActionHandler().changePassword(
                telegramID,
                currentPassword,
                newPassword
            )
            await this.firestore.clearCommandPartial(telegramID)
            return {
                message:
                    `You successfully changed your password to "${newPassword}". Please remember your ` +
                    `new password, but keep it safe from others, and please remember to clear this conversation to ` +
                    `remove sensitive information.`,
                keyboard: 'p1'
            }
        } catch (e) {
            return e.toString()
        }
    }

    async afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
                let checkCode = await new ActionHandler().check2FA(
                    this.commandConvo.data().telegramID,
                    value
                )

                if (checkCode)
                    return {
                        message:
                            `Please enter your current password followed by you new password, ` +
                            `each separated by a space, or click "Cancel". \n\nExample: yourPassword yourNewPassword`,
                        keyboard: [{ text: 'Cancel', callback_data: '/clear' }]
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
                            { text: 'New Code', callback_data: '/requestNew2FACode' },
                            { text: 'Cancel', callback_data: '/help' }
                        ]
                    }
                }
            default:
                return {
                    message:
                        'Not sure what to do here. Click "Cancel" to cancel the current command.',
                    keyboard: [{ text: 'Cancel', callback_data: '/clear' }]
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
        if (!validated) throw `Please enter a valid ${step}`
        let params = {}
        params[step] = value
        try {
            await this.firestore.setCommandPartial(this.commandConvo.id, params)
            return this.afterMessageForStep(step, value)
        } catch (e) {
            throw `An error occurred, please try sending "${step}" again.`
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
}

module.exports = ChangePasswordConvo
