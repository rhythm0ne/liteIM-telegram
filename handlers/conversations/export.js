const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')

const steps = ['type', 'code']

const keyboards = {
    type: [
        [
            { text: 'key', callback_data: 'key' },
            { text: 'phrase', callback_data: 'phrase' }
        ],
        [{ text: 'Cancel', callback_data: '/clear' }]
    ]
}

class ExportConvo {
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
        return {
            message:
                'I can help you export your wallet so you can import it into another wallet. Just remember to ' +
                "keep this safe, and don't share it with anyone! Do you want me to show you your private key WIF, " +
                'or your mnemonic seed phrase?',
            keyboard: keyboards['type']
        }
    }

    async complete(value) {
        let { telegramID, type } = this.commandConvo.data()
        try {
            let secret = await new ActionHandler().export(telegramID, type, value)
            await this.firestore.clearCommandPartial(telegramID)
            if (type === 'key')
                return {
                    message: `<pre>${secret}</pre>`,
                    keyboard: [[{ text: 'Main Menu', callback_data: '/help' }]]
                }
            else if (type === 'phrase')
                return {
                    message: `<pre>${secret}</pre>`,
                    keyboard: [[{ text: 'Main Menu', callback_data: '/help' }]]
                }
        } catch (e) {
            return e.toString()
        }
    }

    async afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
                let result = await new ActionHandler().request2FA(
                    this.commandConvo.data().telegramID
                )
                if (result)
                    return {
                        message: `Please enter the two factor authentication code you received via SMS.`,
                        keyboard: [
                            { text: 'New Code', callback_data: '/requestNew2FACode type' },
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
            case steps[1]:
                let checkCode = await new ActionHandler().check2FA(
                    this.commandConvo.data().telegramID,
                    value
                )

                if (checkCode)
                    return {
                        message: `Please reply with your password and I'll get that for you right away.`,
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
                            { text: 'New Code', callback_data: '/requestNew2FACode type' },
                            { text: 'Cancel', callback_data: '/help' }
                            ]
                    }
                }
            default:
                return 'Not sure what to do here. Reply /clear to cancel the current command.'
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
            throw `An error occurred, please try sending "${step}" again.`
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
}

module.exports = ExportConvo
