require('dotenv').config()
const Express = require('express')
const express = Express()
const helmet = require('helmet')
const bodyParser = require('body-parser')

express.use(helmet())
express.use(bodyParser.json())
express.use(bodyParser.urlencoded({ extended: false }))

express.get(process.env.BASE_PATH + '/:service/webhook/', function(req, res) {
    if (req.query['hub.verify_token'] === process.env.FB_VERIFY_TOKEN) {
        return res.send(req.query['hub.challenge'])
    }
    res.send('wrong token')
})

express.post(process.env.BASE_PATH + '/:service/webhook', async (req, res, next) => {
    res.locals.service = req.params.service

    const handleService = require(`./handlers/services/${req.params.service}`)
        .middleware
    const handler = await handleService(req, res)

    res.status(200)
    if (handler.error) return res.send(handler.error)
    if (!handler.success) return res.send('unknown error')

    let handleCommands = await require('./handlers/parsers/commands')(req, res)
    if (!handleCommands.continue) return

    let handleConversations = await require('./handlers/parsers/conversations')(
        req,
        res
    )
    if (!handleConversations.continue) return

    await require('./handlers/parsers/uncaught')(req, res)
})

express.post(process.env.BASE_PATH + '/notifier', async (req, res) => {
    const notifier = require('./handlers/notifier')

    let notifierResult = false
    try {
        notifierResult = await notifier(req.body)
    } catch (e) {
        console.log(e)
    }

    res.send(notifierResult)
})

express.post(process.env.BASE_PATH + '/broadcast', async (req, res) => {
    const broadcast = require('./handlers/broadcast')

    let broadcastResult = false
    try {
        broadcastResult = await broadcast(req.body)
    } catch (e) {
        console.log(e)
    }

    res.send(broadcastResult)
})

let port = process.env.port || 3001
express.listen(port, err => {
    if (err) return console.error('ERROR:', err)
    console.log('Server is listening on port ', port)
})
