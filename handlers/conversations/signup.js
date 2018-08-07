const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')

const steps = ['email']

class SignupConvo {
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
       return 'What is your primary email address?'
    }

    async complete(value) {
        //TODO: validate password complexity
        let { telegramID, email } = this.commandConvo.data()
        try {
            let address = await new ActionHandler().signup(telegramID, email, value)

            const ConvoHandler = require('../convo_handler')
            await new ConvoHandler(telegramID).createNewCommandPartial('/enable2fa')

            return { message: `You successfully signed up and your wallet address is: <pre>${address}</pre> \n` +
                `But first, we'll need to setup two factor authentication to protect your wallet. Please enter ` +
                `your mobile phone number in this format (without the brackets) followed by your password: ` +
                `+[country][number] \nExample: +17185555555 yourpassword` }
        } catch (e) {
            return { message: e.toString(), keyboard: [{ text: 'Cancel', callback_data: '/start'}] }
        }
    }

    afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
                return { message: `Please enter a safe password for your Lite.IM account.`,
                    keyboard: [{ text: 'Cancel', callback_data: '/start'}] }
            default:
                return { message: 'Not sure what to do here. Click Cancel to try again.',
                    keyboard: [{ text: 'Cancel', callback_data: '/start'}] }
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
        if (!validated) throw `Please enter a valid ${step}.`
        let params = {}
        params[step] = value
        try {
            await this.firestore.setCommandPartial(this.commandConvo.id, params)
            return await this.afterMessageForStep(step, value)
        } catch (e) {
            throw `An error occurred, please try sending "${step}" again.`
        }
    }

    async validateStep(step, value) {
        switch (step) {
            case steps[0]:
                return new ActionHandler().isEmail(value)
            default:
                return false
        }
    }
}

module.exports = SignupConvo
