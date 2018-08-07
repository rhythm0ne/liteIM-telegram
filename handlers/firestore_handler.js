const firebase = require('firebase-admin')

let credential, databaseURL
if (process.env.STAGE === 'production') {
    credential = require('../instances/firebase_prod_credentials.json')
    databaseURL =process.env.FIREBASE_PROD_URL
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

class FirestoreHandler {
    constructor() {
        this.store = firebase.firestore()
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
        return await this.auth().createUser({ email, password })
    }

    async getToken(email, password) {
        const request = require('request')

        const data = {
            email: email,
            password: password,
            returnSecureToken: true
        }

        let key
        if (process.env.STAGE === 'production') key = process.env.FIREBASE_PROD_API_KEY
        else if (process.env.STAGE === 'staging') key = process.env.FIREBASE_STAGING_API_KEY
        else key = process.env.FIREBASE_DEV_API_KEY

        return new Promise(function(resolve, reject) {
            request(
                {
                    url:
                        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${key}`,
                    method: 'POST',
                    json: true,
                    body: data
                },
                function(error, response, body) {
                    if (!error && response.statusCode === 200) {
                        body.idToken
                            ? resolve(body.idToken)
                            : reject(
                                  'A token could not be issued with these credentials.'
                              )
                    } else {
                        reject(
                            error
                                ? error
                                : 'A token could not be issued with these credentials.'
                        )
                    }
                }
            )
        })
    }

    async getUserByEmail(email) {
        return await this.auth().getUserByEmail(email)
    }

    // Actions

    async fetchWallet(id) {
        let doc = await this.doc('wallets', id).get()
        if (doc.exists) return doc
        throw doc
    }

    async fetchWalletByUserId(id) {
        let result = await this.collection('wallets')
            .where('belongsTo', '==', id)
            .get()
        if (result.size > 0 && result.docs[0].exists) return result.docs[0]
        throw result
    }

    async fetchWalletByEmail(email) {
        let user = await this.getUserByEmail(email)
        return await this.fetchWalletByUserId(user.uid)
    }

    async fetchWalletByTelegramID(telegramID) {
        let user = await this.fetchTelegramUser(telegramID)
        return await this.fetchWalletByEmail(user.data().email)
    }

    async fetchTelegramUser(telegramID) {
        let result = await this.collection('telegramUsers')
            .where('telegramID', '==', telegramID)
            .get()
        if (result.size > 0 && result.docs[0].exists) return result.docs[0]
        throw result
    }

    async fetchTelegramUserByFirebaseID(firebaseID) {
        let telegramUserDoc = await this.collection('telegramUsers')
            .doc(firebaseID)
            .get()
        let user = telegramUserDoc.exists ? telegramUserDoc.data() : null
        if (!user) throw('User not found by firebaseID.')
        return user
    }

    async fetchTwoFactorData(firebaseID) {
        let doc = await this.collection('two_factor')
            .doc(firebaseID)
            .get()
        let twoFactorData = doc.exists ? doc.data() : null
        if (!twoFactorData) return false
        return twoFactorData
    }

    async fetchTransactions(userID, startTime = null) {
        let query = this.collection('public_user_data')
            .doc(userID)
            .collection('transactions')
            .orderBy('time', 'desc')
            .limit(100)

        if (startTime) query = query.where('time', '<=', Number(startTime))

        let transactions = []
        await query.get()
            .then(snapshot => {
                if (snapshot.size <= 0) throw 'No transactions found'
                snapshot.forEach(transaction => {
                    if (transaction.exists){
                        let tx = transaction.data()
                        transactions.push(tx)
                    }
                })
            })

        if (startTime) {
            let userDoc = await this.collection('telegramUsers').doc(userID).get()
            let startID = userDoc.data().nextTransactionID

            let index
            for(let i = 0; i < transactions.length; i++) {
                if(transactions[i].txid === startID) index = i
            }

            transactions = transactions.slice(index, index+4)
        } else transactions = transactions.slice(0, 4)

        return transactions
    }

    async addTelegramUser(userID, telegramID, email) {
        return await this.collection('telegramUsers')
            .doc(userID)
            .set({ telegramID, email })
    }

    async fetchCommandPartial(telegramID) {
        let result = await this.collection('commandPartials')
            .where('telegramID', '==', telegramID)
            .get()
        if (result.size > 0 && result.docs[0].exists) return result.docs[0]
        throw result
    }

    async addCommandPartial(telegramID, command) {
        return await this.collection('commandPartials').add({ command, telegramID })
    }

    async setCommandPartial(id, commandPartial, merge = true) {
        return await this.collection('commandPartials')
            .doc(id)
            .set(commandPartial, { merge })
    }

    async clearCommandPartial(telegramID) {
        let result = await this.collection('commandPartials')
            .where('telegramID', '==', telegramID)
            .get()
        result.forEach(partial => {
            partial.ref.delete()
        })
        return true
    }

    async setBotMessageID(telegramID, messageID) {
        return await this.collection('telegramUsers')
            .doc('state')
            .collection('ongoingMessages')
            .doc(telegramID.toString())
            .set({ messageID }, { merge: true })
            .catch(err => {
                throw `Could not set the ongoing conversation for this user.`
            })
    }

    async getBotMessageID(telegramID) {
        return await this.collection('telegramUsers')
            .doc('state')
            .collection('ongoingMessages')
            .doc(telegramID.toString())
            .get()
            .then(snapshot => {
                if (snapshot.exists) {
                    return snapshot.data()
                } else throw `Could not get the ongoing conversation for this user.`
            })
            .catch(err => {
                console.log(err)
                throw `Could not get the ongoing conversation for this user.`
            })

    }

    async setNextTransactionID(userID, nextID) {
        return await this.collection('telegramUsers')
            .doc(userID)
            .set({ nextTransactionID: nextID }, { merge: true })
    }

    async setBotCallbackID(telegramID, callbackID) {
        return await this.collection('telegramUsers')
            .where('telegramID', '==', telegramID)
            .limit(1)
            .get()
            .then(snapshot => {
                if (snapshot.docs[0] && snapshot.docs[0].exists) {
                    return snapshot.docs[0].ref.set({ callbackID }, { merge: true })
                } else throw 'Could not fetch user to update messageID in telegramUsers'
            })
            .catch(err => {
                throw err
            })

    }
}

// Helpers

// const handleError = (error, callback) => {
//   console.log(error);
//   if(callback) callback();
// };

module.exports = FirestoreHandler
