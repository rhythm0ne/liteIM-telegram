const firebase = require('firebase-admin')
const Responder = require('../utils/responder')

let credential, databaseURL
if (process.env.STAGE === 'production') {
    credential = require('../instances/firebase_prod_credentials.json')
    databaseURL = process.env.FIREBASE_PROD_URL
} else if (process.env.STAGE === 'staging') {
    credential = require('../instances/firebase_staging_credentials.json')
    databaseURL = process.env.FIREBASE_STAGING_URL
} else {
    credential = require('../instances/firebase_dev_credentials.json')
    databaseURL = process.env.FIREBASE_DEV_URL
}

firebase.initializeApp({
    credential: firebase.credential.cert(credential),
    databaseURL
})

firebase.firestore().settings({ timestampsInSnapshots: true })

class FirestoreHandler {
    constructor() {
        this.store = firebase.firestore()
        this.responder = new Responder()
    }

    // Convenience methods

    collection(name) {
        return this.getStore().collection(name)
    }

    doc(name, id) {
        return this.collection(name).doc(id)
    }

    auth() {
        return firebase.auth()
    }

    getStore() {
        return this.store
    }

    // Authentication

    async signUp(email, password) {
        try {
            return await this.auth().createUser({ email, password })
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }

    }

    async getToken(email, password) {
        try {
            const request = require('request')

            const data = {
                email: email,
                password: password,
                returnSecureToken: true
            }

            let key
            if (process.env.STAGE === 'production')
                key = process.env.FIREBASE_PROD_API_KEY
            else if (process.env.STAGE === 'staging')
                key = process.env.FIREBASE_STAGING_API_KEY
            else key = process.env.FIREBASE_DEV_API_KEY

            let self = this
            let tokenPromise = new Promise((resolve, reject) => {
                    request(
                        {
                            url: `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${key}`,
                            method: 'POST',
                            json: true,
                            body: data
                        },
                        function (error, response, body) {
                            if (!error && response.statusCode === 200) {
                                if (!body.idToken) reject(self.responder.response('failure', 'password'))
                                else resolve(body.idToken)
                            } else {
                                reject(self.responder.response('failure', 'password'))
                            }
                        }
                    )
                })

            const token = await tokenPromise
                .catch(err => {
                    throw err
                })
            return token

        } catch (err) {
            console.log(err)
            throw err
        }
    }

    async getUserByEmail(email) {
        try {
            return await this.auth().getUserByEmail(email)
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    // Actions

    async fetchWallet(id) {
        try {
            let doc = await this.doc('wallets', id).get()
            if (doc.exists) return doc
            throw doc
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }

    }

    async fetchWalletByUserId(id) {
        try {
            let result = await this.collection('wallets')
                .where('belongsTo', '==', id)
                .get()
            if (result.size > 0 && result.docs[0].exists) return result.docs[0]
            throw result
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async fetchWalletByEmail(email) {
        try {
            let user = await this.getUserByEmail(email)
            return await this.fetchWalletByUserId(user.uid)
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async fetchWalletByTelegramID(telegramID) {
        try {
            let user = await this.fetchTelegramUser(telegramID)
            return await this.fetchWalletByUserId(user.id)
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async fetchTelegramUser(telegramID) {
        try {
            let result = await this.collection('telegramUsers')
                .where('telegramID', '==', Number(telegramID))
                .get()
            if (result.size > 0 && result.docs[0].exists) return result.docs[0]
            throw 'TelegramID not found.'
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async fetchTelegramUserByFirebaseID(firebaseID) {
        try {
            let telegramUserDoc = await this.collection('telegramUsers')
                .doc(firebaseID)
                .get()
            let user = telegramUserDoc.exists ? telegramUserDoc.data() : null
            if (!user) throw 'User not found by firebaseID.'
            return user
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async fetchTelegramUserByAddress(address) {
        try {
            let walletDoc = await this.collection('wallets')
                .doc(address)
                .get()
            let wallet = walletDoc.exists ? walletDoc.data() : null
            if (!wallet) throw 'User not found by firebaseID.'

            let userID = wallet.belongsTo
            return this.fetchTelegramUserByFirebaseID(userID)
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async fetchTwoFactorData(firebaseID) {
        try {
            let doc = await this.collection('two_factor')
                .doc(firebaseID)
                .get()
            let twoFactorData = doc.exists ? doc.data() : null
            if (!twoFactorData) return false
            return twoFactorData
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async fetchTransactions(address, startTime = null, startID = null) {
        try {
            let query = this.collection('transactions')
                .where('_parties', 'array-contains', address)
                .orderBy('time', 'desc')
                .orderBy('txid', 'asc')
                .limit(4)
            if (startTime && startID) query = query.startAt(startTime, startID)
            let transactions = []
            return query.get().then(snapshot => {
                if (snapshot.size <= 0) throw 'No transactions found'
                snapshot.forEach(transaction => {
                    if (transaction.exists) {
                        let tx = transaction.data()
                        transactions.push(tx)
                    }
                })
                return transactions
            })
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async addTelegramUser(userID, telegramID, email) {
        try {
            telegramID = Number(telegramID)
            return await this.collection('telegramUsers')
                .doc(userID)
                .set({ telegramID, email })
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async fetchCommandPartial(telegramID) {
        try {
            return this
                .collection('telegramUsers')
                .doc('state')
                .collection('commandPartials')
                .doc(telegramID.toString())
                .get()
                .then(doc => {
                    if (doc && doc.exists) return doc
                    else throw this.responder.response('failure', 'generic')
                })
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async addCommandPartial(telegramID, command) {
        try {
            return this
                .collection('telegramUsers')
                .doc('state')
                .collection('commandPartials')
                .doc(telegramID.toString())
                .set({ command })
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async setCommandPartial(telegramID, commandPartial, merge = true) {
        try {
            return this
                .collection('telegramUsers')
                .doc('state')
                .collection('commandPartials')
                .doc(telegramID.toString())
                .set(commandPartial, { merge })
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async unsetCommandPartial(telegramID, field) {
        try {
            let FieldValue = require('firebase-admin').firestore.FieldValue
            return this
                .collection('telegramUsers')
                .doc('state')
                .collection('commandPartials')
                .doc(telegramID.toString())
                .update({
                    [field]: FieldValue.delete()
                })
        } catch (err) {
            console.log(err)
        }
    }

    async clearCommandPartial(telegramID) {
        try {
            return this
                .collection('telegramUsers')
                .doc('state')
                .collection('commandPartials')
                .doc(telegramID.toString())
                .delete()
        } catch (err) {
            console.log(err)
        }
    }

    async setBotMessageID(telegramID, messageID) {
        try {
            return await this.collection('telegramUsers')
                .doc('state')
                .collection('ongoingMessages')
                .doc(telegramID.toString())
                .set({ messageID }, { merge: true })
                .catch(err => {
                    throw `Could not set the ongoing conversation for this user.`
                })
        } catch (err) {
            console.log(err)
        }
    }

    async getBotMessageID(telegramID) {
        try {
            return await this.collection('telegramUsers')
                .doc('state')
                .collection('ongoingMessages')
                .doc(telegramID.toString())
                .get()
                .then(snapshot => {
                    if (snapshot.exists) {
                        return snapshot.data()
                    } else {
                        console.log(
                            `Could not get the ongoing conversation for ${telegramID}.`
                        )
                        return false
                    }
                })
                .catch(err => {
                    console.log(
                        `Could not get the ongoing conversation for ${telegramID}.`
                    )
                    return false
                })
        } catch (err) {
            console.log(err)
        }
    }

    async checkIfEmailExists(email) {
        try {
            await this.auth().getUserByEmail(email) //this returns if exists, throws if doesn't
            return true
        } catch(err) {
            if (err.code === 'auth/user-not-found') return false
            else throw err
        }
    }

    async checkIfPhoneNumberExists(number) {
        try {
            return this.collection('two_factor')
                .where('phoneNumber', '==', number)
                .limit(1)
                .get()
                .then(snapshot => {
                    if (snapshot.size > 0 && snapshot.docs[0].exists) return true
                    else return false
                })
                .catch(err => {
                    throw this.responder.response('failure', 'generic')
                })
        } catch (err) {
            throw err
        }
    }

    async enable2FA(telegramID, phone, code) {
        try {
            telegramID = telegramID.toString()
            await this.collection('two_factor')
                .doc(telegramID.toString())
                .set({
                    activated: false,
                    type: 'sms',
                    phoneNumber: phone,
                    credentialExpires: null,
                    onLogin: true,
                    onTransaction: false
                })
                .then(() => {
                    this.collection('pending_two_factor')
                        .doc(phone)
                        .set({
                            type: 'sms',
                            actionType: 'enable',
                            textMatch: code,
                            belongsTo: telegramID,
                            phone: phone,
                            expiresAt: Date.now() + 120 * 1000
                        })
                        .then(() => {
                            return true
                        })
                        .catch(err => {
                            throw err
                        })
                })
                .catch(err => {
                    throw err
                })
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async request2FA(userID, code) {
        try {
            return this.collection('two_factor')
                .doc(userID)
                .get()
                .then(async doc => {
                    if (doc && doc.exists) {
                        const phone = doc.data().phoneNumber
                        return await this.collection('pending_two_factor')
                            .doc(phone)
                            .set({
                                type: 'sms',
                                actionType: 'enable',
                                textMatch: code,
                                belongsTo: userID,
                                phone: phone,
                                expiresAt: Date.now() + 120 * 1000
                            })
                            .then(() => {
                                return phone
                            })
                            .catch(err => {
                                throw this.responder.response('failure', 'generic')
                            })
                    } else throw this.responder.response('failure', 'twoFactor', 'notFound')
                })
                .catch(err => {
                    throw this.responder.response('failure', 'generic')
                })
        } catch (err) {
            console.log(err)
            throw this.responder.response('failure', 'generic')
        }
    }

    async check2FA(telegramID, code, userID = null) {
        try {
            let user = userID ? userID : telegramID.toString()
            let twoFactorRef = this.collection('two_factor').doc(user)

            let twoFactorDoc = await twoFactorRef
                .get()
                .catch(() => {
                    throw this.responder.response('failure', 'generic')
                })
            let twoFactor = twoFactorDoc.exists ? twoFactorDoc.data() : null
            if (!twoFactor) throw this.responder.response('failure', 'twoFactor', 'notEnabled')

            let pendingDoc = await this.collection('pending_two_factor')
                .doc(twoFactor.phoneNumber)
                .get()
                .catch(() => {
                    throw this.responder.response('failure', 'generic')
                })
            let pending = pendingDoc.exists ? pendingDoc.data() : null
            if (!pending) throw this.responder.response('failure', 'twoFactor', 'noPending')

            if (pending.expiresAt <= Date.now()) throw this.responder.response('failure', 'twoFactor', 'invalid')
            if (pending.textMatch !== code.toString()) throw this.responder.response('failure', 'twoFactor', 'invalid')

            let obj = {credentialExpires: Date.now() + 300 * 1000}
            if (pending.actionType === 'enable') obj.activated = true
            if (pending.actionType === 'disable') obj.activated = false

            await twoFactorRef.set(obj, {merge: true})
                .catch(() => {
                    throw this.responder.response('failure', 'generic')
                })
            return true
        } catch (err) {
            throw err
        }
    }

    async unsetPartial2FA(telegramID) {
        try {
            await this.collection('two_factor')
                .doc(telegramID.toString())
                .get()
                .then(doc => {
                    if (doc && doc.exists) {
                        doc.ref.delete()
                    }
                })
            return true
        } catch (err) {
            console.log(err)
        }
    }

    async updateIdOn2FA(telegramID) {
        try {
            let fetchTelegramUser = await this.fetchTelegramUser(telegramID)
            let firebaseID = fetchTelegramUser.id
            await this.collection('two_factor')
                .doc(telegramID.toString())
                .get()
                .then(doc => {
                    if (doc && doc.exists) {
                        let data = doc.data()
                        this.collection('two_factor')
                            .doc(firebaseID)
                            .set(data)
                            .then(() => {
                                doc.ref.delete()
                                return true
                            })
                            .catch(err => {
                                console.log(err)
                                throw 'Could not update the ID of the 2FA entry.'
                            })
                    } else
                        throw 'Could not find 2FA for this user.'.catch(err => {
                            console.log(err)
                            throw 'Could not find 2FA for this user.'
                        })
                })
        } catch (err) {
            console.log(err)
        }
    }

    async createPublicUserData(userId, email) {
        try {
            return this
                .collection('public_user_data')
                .doc(userId)
                .set({
                    email,
                    createdAt: Date.now()
                }, { merge: true })
        } catch (err) {
            console.log(err)
        }
    }

    async fetchNextTransactionID(userID) {
        try {
            return this.collection('telegramUsers')
                .doc(userID)
                .get()
                .then(doc => {
                    if (doc && doc.exists) {
                        let nextTime = doc.data()._nextTime
                        let nextID = doc.data()._nextTransactionID

                        return { nextTime, nextID }
                    }
                })
        } catch (err) {
            console.log(err)
        }
    }

    async setNextTransactionID(userID, nextTime, nextID) {
        try {
            return this.collection('telegramUsers')
                .doc(userID)
                .set({
                    _nextTime: nextTime,
                    _nextTransactionID: nextID
                }, { merge: true })
        } catch (err) {
            console.log(err)
        }
    }

    async unsetNextTransactionID(userID) {
        try {
            let FieldValue = require('firebase-admin').firestore.FieldValue
            return this.collection('telegramUsers')
                .doc(userID)
                .set({
                    _nextTime: FieldValue.delete(),
                    _nextTransactionID: FieldValue.delete()
                }, { merge: true })
        } catch (err) {
            console.log(err)
        }
    }

    async setBotCallbackID(telegramID, callbackID) {
        try {
            return await this.collection('telegramUsers')
                .where('telegramID', '==', telegramID)
                .limit(1)
                .get()
                .then(snapshot => {
                    if (snapshot.docs[0] && snapshot.docs[0].exists) {
                        return snapshot.docs[0].ref.set({ callbackID }, { merge: true })
                    } else
                        throw 'Could not fetch user to update messageID in telegramUsers'
                })
                .catch(err => {
                    throw err
                })
        } catch (err) {
            console.log(err)
        }
    }
}

module.exports = FirestoreHandler
