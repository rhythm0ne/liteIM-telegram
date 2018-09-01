const LtcApi = require('../utils/ltc_api')
const Responder = require('../utils/responder')
const Firestore = require('./firestore_handler')
const Twilio = require('./twilio_handler')
const uuid = require('uuid')

const ltcApi = token => {
    return new LtcApi(token)
}

class ActionHandler {
    constructor() {
        this.firestore = new Firestore()
        this.responder = new Responder()
    }

    // Commands

    async signup(telegramID, email, password) {
        if (await this.alreadySignedUp(email, telegramID))
            throw this.responder.response('failure', 'alreadyRegistered')
        try {
            let user = await this.firestore.signUp(email, password)
            const userID = user.uid
            await this.firestore.addTelegramUser(userID, telegramID, email)
            let token = await this.firestore.getToken(email, password)
            let ltc = ltcApi(token)
            let { data } = await ltc.createWallet(password)
            if (data.success) {
                await this.firestore.createPublicUserData(userID, email)
                return data.data.wallet.address
            }
            else throw this.responder.response('failure', 'signup', 'backend')
        } catch (err) {
            console.log(err)
            //TODO: Rollback all created objects
            throw err
        }
    }

    async send(to, amount, password, user) {
        try {
            let token = await this.getToken(user.email, password)
            let toWallet, toEmail, toUser
            if (this.isEmail(to)) {
                let fetchToWallet = await this.firestore.fetchWalletByEmail(to)
                let fetchToUser = await this.firestore.getUserByEmail(to)
                let toUserFirebaseId = fetchToUser.uid
                let fetchToUserTelegramId = await this.firestore.fetchTelegramUserByFirebaseID(
                    toUserFirebaseId
                )
                toUser = fetchToUserTelegramId.telegramID
                toWallet = fetchToWallet.id
                toEmail = to
            } else if (this.isLitecoinAddress(to)) {
                toWallet = to
                try {
                    let checkIfRegistered = await this.firestore.fetchWallet(to)
                    let toUserFirebaseId = checkIfRegistered.data().belongsTo
                    let fetchToUserTelegramId = await this.firestore.fetchTelegramUserByFirebaseID(
                        toUserFirebaseId
                    )
                    toUser = fetchToUserTelegramId.telegramID
                } catch (e) {} //ignore exception, recipient is simply not a registered user
            } else
                throw this.responder.response('failure', 'send', 'invalidAddress')

            let ltc = ltcApi(token)
            let fetchFromWallet = await this.firestore.fetchWalletByUserId(
                user.id
            )
            let from = fetchFromWallet.data().address
            let interfaceMockId = uuid.v4()

            let response = await ltc.transferLtc(
                toWallet,
                amount,
                password,
                from,
                interfaceMockId,
                toEmail
            )
            let { success, data, error } = response.data
            if (success) return { txid: data.transaction, toUser }
            else {
                if (error && (error === 'NO_UTXO' || error === 'INPUT_OUTPUT'))
                    throw this.responder.response('failure', 'send', 'noUTXOs')
                else throw this.responder.response('failure', 'send', 'transaction')
            }
        } catch (err) {
            throw err
        }
    }

    async balance(userID) {
        try {
            let walletData = await this.firestore.fetchWalletByUserId(userID)
            let balance = walletData.data().currencies.ltc
            return balance
        } catch (err) {
            console.log(err)
            throw err
        }
    }

    async changePassword(user, currentPassword, newPassword) {
        try {
            let token = await this.getToken(user.email, currentPassword)
            let { data } = await ltcApi(token).changePassword(
                currentPassword,
                newPassword
            )
            let { success } = data
            if (success) {
                await this.firestore.auth().updateUser(user.id, {
                    password: newPassword
                })
                return true
            } else throw this.responder.response('failure', 'changePassword', 'backend')
        } catch (err) {
            throw err
        }
    }

    async changeEmail(user, email, password) {
        try {
            let token = await this.getToken(user.email, password)
            let ltc = ltcApi(token)
            let { data } = await ltc.changeEmail(email, password)
            let { success } = data
            if (success) {
                await this.firestore
                    .collection('telegramUsers')
                    .doc(user.id)
                    .set({ email }, { merge: true })

                await this.firestore.auth().updateUser(user.id, {
                    email
                })
                return true
            } else throw this.responder.response('failure', 'changeEmail', 'backend')
        } catch (err) {
            throw err
        }
    }

    async export(user, type, password) {
        try {
            let token = await this.getToken(user.email, password)
            let ltc = ltcApi(token)
            let fetchWallet = await this.firestore.fetchWalletByUserId(
                user.id
            )
            let wallet = fetchWallet.data().address
            let fetchKey = await ltc.exportPrivateKey(password, wallet)

            let { success, data } = fetchKey.data
            if (!success)
                throw this.responder.response('failure', 'export', 'backend', { type })
            if (type === 'key') {
                return data.privateKey
            } else {
                return data.phrase
            }
        } catch (err) {
            throw err
        }
    }

    async receive(user) {
        try {
            let walletData = await this.firestore.fetchWalletByUserId(user.id)
            let wallet = walletData.data().address
            let email = user.email

            return { wallet, email }
        } catch (err) {
            throw err
        }
    }

    async getTransactions(userID, getMore = false) {
        try {
            let walletData = await this.firestore.fetchWalletByUserId(userID)
            let address = walletData.data().address

            let startTime, startID
            if (getMore) {
                let values = await this.firestore.fetchNextTransactionID(userID)
                startTime = values.nextTime
                startID = values.nextID
            }

            let transactions = await this.firestore.fetchTransactions(
                address,
                startTime,
                startID
            )

            let more = false
            if (transactions.length > 3) {
                more = true
                let nextTime = transactions[3].time
                let nextID = transactions[3].txid
                await this.firestore.setNextTransactionID(userID, nextTime, nextID)
            } else {
                await this.firestore.unsetNextTransactionID(userID)
            }
            return { transactions: transactions.slice(0, 3), more }

        } catch (err) {
            throw err
        }
    }

    // Two Factor Authentication

    async enable2FA(telegramID, phone) {
        try {
            let code = this.generate2FACode()
            await this.firestore.enable2FA(telegramID, phone, code)

            try {
                phone = phone.toString()
                if (phone.charAt(0) !== '+') {
                    phone = `+${phone}`
                }

                let twilio = new Twilio()
                return await twilio.send(
                    phone,
                    `Thank you for using Lite.IM. Your code is: ${code}`
                )
            } catch (err) {
                console.log(err)
                throw this.responder.response('failure', 'generic')
            }
        } catch (err) {
            throw err
        }
    }

    async request2FA(userID) {
        try {
            let code = this.generate2FACode()
            let phone = await this.firestore.request2FA(userID, code)

            phone = phone.toString()
            if (phone.charAt(0) !== '+') {
                phone = `+${phone}`
            }

            try {
                let twilio = new Twilio()
                return await twilio.send(
                    phone,
                    `Here is your Lite.IM security code: ${code}`
                )
            } catch (err) {
                console.log(err)
                throw this.responder.response('failure', 'generic')
            }
        } catch (err) {
            throw err
        }
    }

    async check2FA(telegramID, code, userID = null) {
        try {
            return await this.firestore.check2FA(telegramID, code, userID)
        } catch (err) {
            console.log(err)
            throw err
        }
    }

    // Helpers

    async checkPassword(email, password) {
        try {
            await this.firestore.getToken(email, password)
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'password')
        }
    }

    async getTelegramUserAndToken(telegramID, password) {
        try {
            let telegramUser = await this.firestore.fetchTelegramUser(telegramID)
            let token = await this.firestore.getToken(
                telegramUser.data().email,
                password
            )
            return { user: telegramUser, token }
        } catch (err) {
            throw err
        }
    }

    async getToken(email, password) {
        try {
           return this.firestore.getToken(
                email,
                password
            )
        } catch (err) {
            throw err
        }

    }

    async getUserFromTelegramID(telegramID) {
        try {
            let fetchTelegramUser = await this.firestore.fetchTelegramUser(
                telegramID
            )
            if (!fetchTelegramUser || !fetchTelegramUser.exists) return false
            let user = fetchTelegramUser.data()
            if (!user) return false

            user.id = fetchTelegramUser.id
            return user

        } catch (e) {
            return false
        }
    }

    async alreadySignedUp(email, telegramID) {
        try {
            await this.firestore.getUserByEmail(email)
            return true
        } catch (e) {
            console.log(`user with email ${email} not found`)
        }
        try {
            await this.firestore.fetchTelegramUser(telegramID)
            return true
        } catch (e) {
            console.log(`user with telegramID ${telegramID} not found.`)
        }
        return false
    }

    async isUserWithout2FA(userID) {
        try {
            let fetchTwoFactorData = await this.firestore.fetchTwoFactorData(userID)
            let activationStatus = fetchTwoFactorData.activated

            if (!activationStatus) return true //is a user, but could not find activation status

            return !activationStatus //returns false if enabled or true if disabled depending on the bool value in firebase
        } catch (e) {
            return false
        }
    }

    async clearCoversationCommand(telegramID) {
        await this.firestore.clearCommandPartial(telegramID)
    }

    isEmail(email) {
        let re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
        return re.test(String(email))
    }

    isLitecoinAddress(address) {
        let litecore = require('litecore-lib')
        return litecore.Address.isValid(address)
    }

    generate2FACode() {
        let code = []
        for (let i = 0; i < 6; i++) {
            code.push(Math.round(Math.random() * 9))
        }
        return code.join('')
    }
}

module.exports = ActionHandler
