const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')

const steps = ['newEmail']

class ChangeEmailConvo {
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

    initialMessage() {
        return `No problem; let's get your email changed. What would you like to change it to?`
    }

    async complete(value) {
        let { telegramID, newEmail } = this.commandConvo.data()
        try {
            let params = value.split(/\s+/)
            params = params.filter(param => param.length > 0)
            if (params.length < 2)
                return `Please enter the two factor code you received followed by your password, separated ` +
                    `by a space. \nExample: 1111 yourpassword`

            let code = params[0]
            let password = params[1]

            let result = await new ActionHandler().check2FA(telegramID, code, password)
            if (!result) {
                return {
                    message: `Please enter the correct code, followed by your current password, ` +
                    `separated by a space, or click "Cancel". \nExample: 1111 yourpassword`,
                    keyboard: [{ text: 'Cancel', callback_data: '/help' }]
                }
            }
            await new ActionHandler().changeEmail(
                telegramID,
                newEmail,
                password
            )
            await this.firestore.clearCommandPartial(telegramID)
            return { message: `Great! Your email address has been updated to ${newEmail}. Please remember ` +
                `to clear this conversation to remove sensitive information.`,
                keyboard: 'p1' }
        } catch (e) {
            return e.toString()
        }
    }

    async afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
                let result = await new ActionHandler().request2FA(this.commandConvo.data().telegramID)
                if (result) {
                    return `Perfect, I'll just need you to provide the two factor code I just sent you along with ` +
                        `your password, separated by a space, before I can change your email address to ${value}, ` +
                        `or click "Cancel". \nExample: 1111 yourpassword`
                }
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
            case steps[0]:
                //validate email address
                return true
            default:
                return false
        }
    }
}

module.exports = ChangeEmailConvo
