const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const PhoneNumberValidator = require('../../utils/validators/phoneNumber')

const steps = ['email', 'phone', 'code']

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
        let { telegramID, email } = this.commandConvo.data()
        try {
            let address = await new ActionHandler().signup(telegramID, email, value)
            if (address) {
                await this.firestore.updateIdOn2FA(telegramID)
                await this.firestore.clearCommandPartial(telegramID)
                return {
                    message: `You successfully signed up and your wallet address is: <pre>${address}</pre>`,
                    keyboard: [{ text: 'Lets Begin!', callback_data: '/help' }]
                }
            } else {
                await this.firestore.clearCommandPartial(telegramID)
                return {
                    message: `There was a problem signing you up. Please try again.`,
                    keyboard: [{ text: 'Try Again', callback_data: '/start' }]
                }
            }
        } catch (e) {
            return {
                message: e.toString(),
                keyboard: [{ text: 'Cancel', callback_data: '/start' }]
            }
        }
    }

    async afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
                let emailExists = false
                try {
                    await this.firestore.getUserByEmail(value)
                    emailExists = true
                } catch (e) {} //ignore this, it just means the email address does not exist, which is what we want

                if (emailExists) {
                    await this.firestore.unsetCommandPartial(
                        this.commandConvo.id,
                        step
                    )
                    return {
                        message: `Sorry, but that email address is already registered. Please use a different one.`,
                        keyboard: [{ text: 'Cancel', callback_data: '/start' }]
                    }
                }

                return {
                    message: `Please enter your mobile phone number in this format: \n+[country][number] \n\nExample: +17185555555`,
                    keyboard: [{ text: 'Cancel', callback_data: '/start' }]
                }

            case steps[1]:
                let number = value
                if (number.charAt(0) === '+') number = number.substr(1)

                let phoneNumberExists = await this.firestore.checkIfPhoneNumberExists(
                    number
                )
                if (phoneNumberExists) {
                    await this.firestore.unsetCommandPartial(
                        this.commandConvo.id,
                        step
                    )
                    return {
                        message:
                            `Sorry, but that phone number is already registered. Please try again ` +
                            `with a different number in this format: \n+[country][number] \n\nExample: +17185555555`,
                        keyboard: [{ text: 'Cancel', callback_data: '/start' }]
                    }
                }

                let enable2FA = await new ActionHandler().enable2FA(
                    this.commandConvo.data().telegramID,
                    number
                )

                if (enable2FA)
                    return {
                        message: `Please enter the code you received at ${value}.`,
                        keyboard: [
                            {
                                text: 'New Code',
                                callback_data: '/requestNew2FACode phone'
                            },
                            { text: 'Cancel', callback_data: '/start' }
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
                        keyboard: [{ text: 'Cancel', callback_data: '/start' }]
                    }
                }

            case steps[2]:
                let code = value
                let checkCode = await new ActionHandler().check2FA(
                    this.commandConvo.data().telegramID,
                    code
                )

                if (checkCode)
                    return {
                        message: `Please enter a safe password for your Lite.IM account.`,
                        keyboard: [{ text: 'Cancel', callback_data: '/start' }]
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
                            {
                                text: 'New Code',
                                callback_data: '/requestNew2FACode phone'
                            },
                            { text: 'Cancel', callback_data: '/start' }
                        ]
                    }
                }

            default:
                return {
                    message: 'Not sure what to do here. Click Cancel to try again.',
                    keyboard: [{ text: 'Cancel', callback_data: '/start' }]
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
        if (!validated) throw `Please enter a valid ${step}.`
        let params = {}
        params[step] = value
        try {
            await this.firestore.setCommandPartial(this.commandConvo.id, params)
            return await this.afterMessageForStep(step, value)
        } catch (e) {
            console.log('ERROR: ', e)
            throw `An error occurred, please try sending "${step}" again.`
        }
    }

    async validateStep(step, value) {
        switch (step) {
            case steps[0]:
                await this.firestore.unsetPartial2FA(
                    this.commandConvo.data().telegramID
                )
                return new ActionHandler().isEmail(value)
            case steps[1]:
                await this.firestore.unsetPartial2FA(
                    this.commandConvo.data().telegramID
                )
                return new PhoneNumberValidator(value).validate()
            case steps[2]:
                return true
            default:
                return false
        }
    }
}

module.exports = SignupConvo
