const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')

const steps = ['type']

const keyboards = {
    'type': [[{ text: 'key', callback_data: 'key' }, { text: 'phrase', callback_data: 'phrase' }], [{ text: 'Cancel', callback_data: '/clear' }]]
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
            message: "I can help you export your wallet so you can import it into another wallet. Just remember to " +
            "keep this safe, and don't share it with anyone! Do you want me to show you your private key WIF, " +
            "or your mnemonic seed phrase?",
            keyboard: keyboards['type']
        }
    }

    async complete(value) {
        let { telegramID, type } = this.commandConvo.data()
        try {
            let params = value.split(/\s+/)
            params = params.filter(param => param.length > 0)
            if (params.length < 2)
                return `Please enter the two factor code you received followed by your password, separated by a space. \nExample: 1111 yourpassword`

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
            let secret = await new ActionHandler().export(telegramID, type, password)
            await this.firestore.clearCommandPartial(telegramID)
            if (type === 'key') return { message: `<pre>${secret}</pre>`,
                keyboard: [[{ text: 'Main Menu', callback_data: '/help' }]] }
            else if (type === 'phrase') return { message: `<pre>${secret}</pre>`,
                keyboard: [[{ text: 'Main Menu', callback_data: '/help' }]] }

        } catch (e) {
            return e.toString()
        }
    }

    async afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
                let result = await new ActionHandler().request2FA(this.commandConvo.data().telegramID)
                if (result) {
                    return `Reply with the 2FA code you just received along with your password, separated by a ` +
                    `space, or click "Cancel". \nExample: 1111 yourpassword`
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
        if (!validated) throw { message: `Please enter a valid ${step}.`, keyboard: keyboards[step] }
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
                return (value === 'key' || value === 'phrase')
            default:
                return false
        }
    }
}

module.exports = ExportConvo
