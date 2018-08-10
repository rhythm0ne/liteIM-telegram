const LtcApi = require('../utils/ltc_api')
const Firestore = require('./firestore_handler')
const Plivo = require('./plivo_handler')
const uuid = require('uuid')

const ltcApi = token => {
    return new LtcApi(token)
}

class ActionHandler {
    constructor() {
        this.firestore = new Firestore()
    }

    // Commands

    async send(to, amount, password, telegramID) {
        try {
            let { token } = await this.getTelegramUserAndToken(telegramID, password)
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
                throw 'You can only send to email addresses and litecoin addresses. Please try again.'

            let ltc = new LtcApi(token)

            let fetchFromWallet = await this.firestore.fetchWalletByTelegramID(
                telegramID
            )
            let from = fetchFromWallet.data().address
            let interfaceMockId = uuid.v4()

            let { data } = await ltc.transferLtc(
                toWallet,
                amount,
                password,
                from,
                interfaceMockId,
                toEmail
            )
            let { success, transaction } = data
            if (success) return { txid: transaction, toUser }
            else throw 'Error sending.'
        } catch (err) {
            console.log(`Send threw: ${err}`)
            if (err === 'A token could not be issued with these credentials.')
                throw 'Invalid password, please try again with the correct password or click Cancel.'
            throw 'Something went wrong, please try again.'
        }
    }

    async signup(telegramID, email, password) {
        if (await this.alreadySignedUp(email, telegramID))
            throw "You already exist, you don't need to sign up."
        try {
            let user = await this.firestore.signUp(email, password)
            const userID = user.uid
            await this.firestore.addTelegramUser(userID, telegramID, email)
            let token = await this.firestore.getToken(email, password)

            let { data } = await ltcApi(token).createWallet(password)
            let { success, wallet } = data
            if (success) return wallet.address
            else throw 'Failed to create wallet.'
        } catch (err) {
            //TODO: Rollback all created objects
            console.log(`Signup threw: ${err}`)
            if (err === 'A token could not be issued with these credentials.')
                throw 'Invalid password, please try again with the correct password or click Cancel.'
            throw 'There was an error signing up, please try again.'
        }
    }

    async balance(telegramID) {
        try {
            let fetchWallet = await this.firestore.fetchWalletByTelegramID(
                telegramID
            )
            let wallet = fetchWallet.data()

            let { data } = await ltcApi().getBalance(wallet.address)

            let { balance, unconfirmedBalance, success } = data
            if (success) return { balance, unconfirmedBalance }
            else throw 'Error getting balance.'
        } catch (err) {
            console.log(`Balance threw: ${err}`)
            throw 'Sorry please try again.'
        }
    }

    async changePassword(telegramID, currentPassword, newPassword) {
        try {
            let getTelegramUser = await this.firestore.fetchTelegramUser(telegramID)
            let userId = getTelegramUser.id

            let { token } = await this.getTelegramUserAndToken(
                telegramID,
                currentPassword
            )

            let { data } = await ltcApi(token).changePassword(
                currentPassword,
                newPassword
            )
            let { success } = data
            if (success) {
                let updatePassword = await this.firestore.auth().updateUser(userId, {
                    password: newPassword
                })
                return true
            } else throw 'Error changing password.'
        } catch (err) {
            console.log(`changePassword threw: ${err}`)
            if (err === 'A token could not be issued with these credentials.')
                throw 'Invalid password, please try again with the correct password or click Cancel.'
            throw 'Sorry please try again.'
        }
    }

    async changeEmail(telegramID, email, password) {
        try {
            let getTelegramUser = await this.firestore.fetchTelegramUser(telegramID)
            let userId = getTelegramUser.id

            let { token } = await this.getTelegramUserAndToken(telegramID, password)

            let ltc = new LtcApi(token)

            let { data } = await ltc.changeEmail(email, password)
            let { success } = data
            if (success) {
                let updateEmailInFirebase = await this.firestore
                    .collection('telegramUsers')
                    .doc(userId)
                    .set({ email }, { merge: true })

                let updateEmail = await this.firestore.auth().updateUser(userId, {
                    email
                })
                return true
            } else throw 'Error changing email address.'
        } catch (err) {
            console.log(`changeEmail threw: ${err}`)
            if (err === 'A token could not be issued with these credentials.')
                throw 'Invalid password, please try again with the correct password or click Cancel.'
            throw 'Sorry please try again.'
        }
    }

    async export(telegramID, type, password) {
        try {
            let { token } = await this.getTelegramUserAndToken(telegramID, password)
            let ltc = new LtcApi(token)

            let fetchWallet = await this.firestore.fetchWalletByTelegramID(
                telegramID
            )
            let wallet = fetchWallet.data().address

            if (type === 'key') {
                let fetchKey = await ltc.exportPrivateKey(password, wallet)
                if (!fetchKey.data.success)
                    throw 'Sorry, I had an issue fetching your private key. Please try again.'
                return fetchKey.data.privateKey
            } else {
                let fetchKey = await ltc.exportMnemonic(password)
                if (!fetchKey.data.success)
                    throw 'Sorry, I had an issue fetching your seed phrase. Please try again.'
                return fetchKey.data.phrase
            }
        } catch (err) {
            console.log(`Export threw: ${err}`)
            if (err === 'A token could not be issued with these credentials.')
                throw 'Invalid password, please try again with the correct password or click Cancel.'
            throw 'Something went wrong, please try again.'
        }
    }

    async receive(telegramID) {
        let walletData = await this.firestore.fetchWalletByTelegramID(telegramID)
        let wallet = walletData.data().address

        let user = await this.firestore.fetchTelegramUser(telegramID)
        let email = user.data().email

        return { wallet, email }
    }

    async sync(telegramID) {
        try {
            let getTelegramUser = await this.firestore.fetchTelegramUser(telegramID)
            let userId = getTelegramUser.id
            await ltcApi().syncTransactions(userId)
        } catch (err) {
            console.log(`sync threw: ${err}`)
            throw 'Something went wrong, please try again.'
        }
    }

    async getTransactions(telegramID, startTime = null, startID = null) {
        try {
            let getTelegramUser = await this.firestore.fetchTelegramUser(telegramID)
            let userID = getTelegramUser.id
            let transactions = await this.firestore.fetchTransactions(
                userID,
                startTime,
                startID
            )

            let nextTime
            if (Object.keys(transactions).length === 4) {
                nextTime = transactions[3].time
                let nextID = transactions[3].txid
                await this.firestore.setNextTransactionID(userID, nextID)
                transactions.splice(-1, 1)
            }

            return { transactions, nextTime }
        } catch (err) {
            console.log(`GetTransactions threw: ${err}`)
            throw err
        }
    }

    // Two Factor Authentication

    async enable2FA(telegramID, phone) {
        try {
            let code = this.generate2FACode()
            await this.firestore.enable2FA(telegramID, phone, code)

            let plivo = new Plivo()
            return await plivo.send(
                phone,
                `Thank you for using Lite.IM. Your code is: ${code}`
            )
        } catch (err) {
            console.log(`enable2FA threw: ${err}`)
            throw 'Sorry, I had an issue with your request. Please try again.'
        }
    }

    async request2FA(telegramID) {
        try {
            let code = this.generate2FACode()
            let phone = await this.firestore.request2FA(telegramID, code)
            let plivo = new Plivo()
            return await plivo.send(
                phone,
                `Here is your Lite.IM security code: ${code}`
            )
        } catch (err) {
            console.log(`request2FA threw: ${err}`)
            throw 'Sorry, I had an issue with your request. Please try again.'
        }
    }

    async check2FA(telegramID, code) {
        try {
            let firebaseID
            try {
                let getTelegramUser = await this.firestore.fetchTelegramUser(
                    telegramID
                )
                firebaseID = getTelegramUser.id
            } catch (_) {} //ignore exception, this just means the user is signing up

            return await this.firestore.check2FA(telegramID, code, firebaseID)
        } catch (err) {
            console.log(`check2FA threw: ${err}`)
            throw 'Sorry, I had an issue with your request. Please try again.'
        }
    }

    // Helpers

    async getTelegramUserAndToken(telegramID, password) {
        let telegramUser = await this.firestore.fetchTelegramUser(telegramID)
        let token = await this.firestore.getToken(
            telegramUser.data().email,
            password
        )
        return { user: telegramUser, token }
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

    async isUserWithout2FA(telegramID) {
        try {
            let fetchTelegramUser = await this.firestore.fetchTelegramUser(
                telegramID
            )
            if (!fetchTelegramUser || !fetchTelegramUser.exists) return false
            let userID = fetchTelegramUser.id

            if (!userID) return false //is not a user, therefore does not need 2FA yet

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
