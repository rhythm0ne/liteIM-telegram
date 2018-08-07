const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const PhoneNumberValidator = require('../../utils/validators/phoneNumber')

const steps = ['number' ]

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
        return `We'll need to setup two factor authentication to protect your account. Please enter your mobile ` +
            `phone number in this format (without the brackets) followed by your password: +[country][number] \n` +
            `Example: +17185555555 yourpassword`
    }

    async complete(value) {
        let { telegramID } = this.commandConvo.data()

        let params = value.split(/\s+/)
        params = params.filter(param => param.length > 0)
        if (params.length < 2)
            return { message: `Please enter the code you received at ${value} followed by your password, separated ` +
                `by a space. \nExample: 1111 yourpassword`,
                keyboard: [{ text: 'Change Phone Number', callback_data: '/enable2fa' }] }

        let code = params[0]
        let password = params[1]

        try {
            let result = await new ActionHandler().check2FA(telegramID, code, password)
            if (result) {
                await this.firestore.clearCommandPartial(telegramID)
                return { message: `Thank you for signing up. Please remember to clear this conversation to remove ` +
                    `sensitive information. Now what would you like to do?`,
                    keyboard: 'p1' }
            } else {
                return { message: `Please enter the correct two factor code that was sent to you, followed ` +
                    `by your password, separated by a space.`,
                    keyboard: [{ text: 'Change Phone Number', callback_data: '/enable2fa' }] }
            }
        } catch (e) {
            return e.toString()
        }
    }

    async afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
                let params = value.split(/\s+/)
                params = params.filter(param => param.length > 0)
                if (params.length < 2)
                    return `Please try again. Enter your mobile phone number in this format (without the brackets) ` +
                        `followed by your password: +[country][number] \nExample: +17185555555 yourpassword`

                let number = params[0]
                let password = params[1]

                if (number.charAt(0) === '+') {
                    number = number.substr(1)
                }

                let result = await new ActionHandler().enable2FA(this.commandConvo.data().telegramID, number, password)

                if (result) {
                    return {
                        message: `Please enter the code you received at ${value} followed by your password, ` +
                        `separated by a space. \nExample: 1111 yourpassword`,
                        keyboard: [[{text: 'Change Phone Number', callback_data: '/changeNumber'}]]
                    }
                }
            default:
                return 'Not sure what to do here.'
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
        let params = { [step]: step }
        if (step !== 'number') params[step] = value //this is to prevent storing the password here

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
                let params = value.split(/\s+/)
                return new PhoneNumberValidator(params[0]).validate()
            default:
                return false
        }
    }
}

module.exports = SignupConvo
