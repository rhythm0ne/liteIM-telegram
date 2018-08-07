const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')

const steps = []

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
            return `I see you'd like to change your password. Please send the code you just received, your ` +
                `current password, and your new password, each separated by a space, or click "Cancel". \n` +
                `Example: 1111 yourpassword yournewpassword`
        }
    }

    async complete(value) {
        let { telegramID } = this.commandConvo.data()
        await this.firestore.clearCommandPartial(telegramID)
        try {
            let params = value.split(/\s+/)
            params = params.filter(param => param.length > 0)
            if (params.length < 3)
                return `Please send the code you just received, your current password, and your new password, each ` +
                    `separated by a space, or click "Cancel". \nExample: 1111 yourpassword yournewpassword`

            let code = params[0]
            let currentPassword = params[1]
            let newPassword = params[2]

            let result = await new ActionHandler().check2FA(telegramID, code, currentPassword)
            if (!result) {
                return {
                    message: `Please enter the correct code, followed by your current password and your new password, ` +
                    `each separated by a space, or click "Cancel". \nExample: 1111 yourpassword yournewpassword`,
                    keyboard: [{ text: 'Cancel', callback_data: '/help' }]
                }
            }

            await new ActionHandler().changePassword(
                telegramID,
                currentPassword,
                newPassword
            )
            return { message: `You successfully changed your password to "${newPassword}". Please remember your ` +
                `new password, but keep it safe from others, and please remember to clear this conversation to ` +
                `remove sensitive information.`, keyboard: 'p1' }
        } catch (e) {
            return e.toString()
        }
    }

    afterMessageForStep(step, value) {
        switch (step) {
            default:
                return 'Not sure what to do here. Click "Cancel" to cancel the current command.'
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
            default:
                return false
        }
    }
}

module.exports = ChangePasswordConvo
