const Firestore = require('../firestore_handler')
const ActionHandler = require('../action_handler')
const PhoneNumberValidator = require('../../utils/validators/phoneNumber')

const steps = ['number', 'code']

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
        return (
            `We'll need to setup two factor authentication to protect your account. Please enter your mobile ` +
            `phone number in this format: \n+[country][number] \n\nExample: +17185555555`
        )
    }

    async complete(value) {
        let { telegramID } = this.commandConvo.data()

        if (await new ActionHandler().getTelegramUserAndToken(telegramID, value)) {
            try {
                await this.firestore.updateIdOn2FA(telegramID)
                await this.firestore.clearCommandPartial(telegramID)
                return {
                    message:
                        `Thank you for signing up. Please remember to clear this conversation to remove ` +
                        `sensitive information. Now what would you like to do?`,
                    keyboard: 'p1'
                }
            } catch (e) {
                console.log(e)
                return {
                    message: 'Something went wrong, please try again.',
                    keyboard: [[{ text: 'Try Again', callback_data: '/enable2fa' }]]
                }
            }
        } else {
            return {
                message: 'Invalid password, please try again.',
                keyboard: [[{ text: 'Try Again', callback_data: '/enable2fa' }]]
            }
        }
    }

    async afterMessageForStep(step, value) {
        switch (step) {
            case steps[0]:
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
                        keyboard: [
                            { text: 'Change Number', callback_data: '/enable2fa' }
                        ]
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
                            { text: 'Change Number', callback_data: '/enable2fa' },
                            {
                                text: 'New Code',
                                callback_data: '/requestNew2FACode number'
                            }
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
                        keyboard: [
                            { text: 'Try Again', callback_data: '/enable2fa' }
                        ]
                    }
                }

            case steps[1]:
                let code = value
                let checkCode = await new ActionHandler().check2FA(
                    this.commandConvo.data().telegramID,
                    code,
                    true
                )

                if (checkCode)
                    return {
                        message: `Please enter your password.`,
                        keyboard: [{ text: 'Cancel', callback_data: '/enable2fa' }]
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
                            { text: 'Change Number', callback_data: '/enable2fa' },
                            {
                                text: 'New Code',
                                callback_data: '/requestNew2FACode number'
                            }
                        ]
                    }
                }

            default:
                return {
                    message: 'Not sure what to do here.',
                    keyboard: [[{ text: 'Try Again', callback_data: '/enable2fa' }]]
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
            if (e === 'Insufficient credits')
                throw `Sorry, but I can only send 200 SMS messages to you per day. Please try again later.`
            throw `An error occurred, please try sending "${step}" again.`
        }
    }

    async validateStep(step, value) {
        switch (step) {
            case steps[0]:
                await this.firestore.unsetPartial2FA(
                    this.commandConvo.data().telegramID
                )
                return new PhoneNumberValidator(value).validate()
            case steps[1]:
                return true
            default:
                return false
        }
    }
}

module.exports = SignupConvo
