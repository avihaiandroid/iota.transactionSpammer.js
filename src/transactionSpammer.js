/**
 * Created by Peter Ryszkiewicz (https://github.com/pRizz) on 9/10/2017.
 * https://github.com/pRizz/iota.transactionSpammer.js
 */

window.iotaTransactionSpammer = (function(){
    const iotaLib = window.IOTA
    const curl = window.curl
    const MAX_TIMESTAMP_VALUE = (Math.pow(3,27) - 1) / 2 // from curl.min.js
    curl.init()
    let iota // initialized in initializeIOTA
    let started = false
    let globalErrorCooldown = 5000 // milliseconds

    // TODO: use this for listening to changes in options and emit change to eventEmitter
    const optionsProxy = new Proxy({
        isLoadBalancing: true // change node after every PoW
    }, {
        set: (obj, prop, value) => {
            obj[prop] = value
            eventEmitter.emitEvent('optionChanged', [prop, value])
            return true
        }
    })

    // from 'https://iotasupport.com/providers.json' + requested additions - unreliable nodes
    // message me on Slack (Peter Ryszkiewicz) or make an issue here is you want your node added: https://github.com/pRizz/iota.transactionSpammer.js/issues
    const httpProviders = [
        "http://service.iotasupport.com:14265",
        "http://node01.iotatoken.nl:14265",
        "http://node02.iotatoken.nl:14265",
        "http://node03.iotatoken.nl:15265",
        "http://mainnet.necropaz.com:14500",
        "http://node.lukaseder.de:14265",
        "http://iota.love:16000",
        "http://iotanode.prizziota.com:80", // author's node :)
    ]

    const httpsProviders = [
        "https://iotanode.prizziota.com:443", // author's node :)
    ]

    const validProviders = getValidProviders()
    let _currentProvider = getRandomProvider()

    // Overrides the _currentProvider
    let customProvider = null

    let depth = 10
    let weight = 14
    let spamSeed = generateSeed()

    const hostingSite = 'https://github.com/pRizz/iota.transactionSpammer.js'
    let message = `This spam was generated by the transaction spammer: ${hostingSite}`
    let tag = "DECODEMESSAGEINASCII"
    let numberOfTransfersInBundle = 1

    const eventEmitter = new EventEmitter()

    let transactionCount = 0
    let confirmationCount = 0
    let averageConfirmationDuration = 0 // milliseconds

    function getNextErrorCooldown() {
        return globalErrorCooldown *= (1.5 + 0.5 * Math.random()) // backoff algorithm
    }

    function getCurrentProvider() {
        if (customProvider) { return customProvider }
        return _currentProvider
    }

    // must be https if the hosting site is served over https; SSL rules
    function getValidProviders() {
        if(isRunningOverHTTPS()) {
            return httpsProviders
        } else {
            return httpProviders.concat(httpsProviders)
        }
    }

    function isRunningOverHTTPS() {
        switch(window.location.protocol) {
            case 'https:':
                return true
            default:
                return false
        }
    }

    // returns a depth in [4, 12] inclusive
    function generateDepth() {
        depth = Math.floor(Math.random() * (12 - 4 + 1)) + 4
        return depth
    }

    // WARNING: Not cryptographically secure. Do not use any seeds generated by this generator to actually store any value.
    function generateSeed() {
        const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ9'
        return Array.from(new Array(81), (x, i) => validChars[Math.floor(Math.random() * validChars.length)]).join('')
    }

    function generateTransfers() {
        return Array.from(new Array(numberOfTransfersInBundle), (x, i) => generateTransfer())
    }

    function getTritifiedAsciiMessage() {
        return iota.utils.toTrytes(message)
    }

    function generateTransfer() {
        return {
            address: spamSeed,
            value: 0,
            message: getTritifiedAsciiMessage(),
            tag: tag
        }
    }

    // adapted from https://github.com/iotaledger/wallet/blob/master/ui/js/iota.lightwallet.js
    const localAttachToTangle = function(trunkTransaction, branchTransaction, minWeightMagnitude, trytes, callback) {
        const ccurlHashing = function(trunkTransaction, branchTransaction, minWeightMagnitude, trytes, callback) {
            const iotaObj = iota;

            // inputValidator: Check if correct hash
            if (!iotaObj.valid.isHash(trunkTransaction)) {
                return callback(new Error("Invalid trunkTransaction"));
            }

            // inputValidator: Check if correct hash
            if (!iotaObj.valid.isHash(branchTransaction)) {
                return callback(new Error("Invalid branchTransaction"));
            }

            // inputValidator: Check if int
            if (!iotaObj.valid.isValue(minWeightMagnitude)) {
                return callback(new Error("Invalid minWeightMagnitude"));
            }

            let finalBundleTrytes = [];
            let previousTxHash;
            let i = 0;

            function loopTrytes() {
                getBundleTrytes(trytes[i], function(error) {
                    if (error) {
                        return callback(error);
                    } else {
                        i++;
                        if (i < trytes.length) {
                            loopTrytes();
                        } else {
                            // reverse the order so that it's ascending from currentIndex
                            return callback(null, finalBundleTrytes.reverse());
                        }
                    }
                });
            }

            function getBundleTrytes(thisTrytes, callback) {
                // PROCESS LOGIC:
                // Start with last index transaction
                // Assign it the trunk / branch which the user has supplied
                // IF there is a bundle, chain  the bundle transactions via
                // trunkTransaction together

                let txObject = iotaObj.utils.transactionObject(thisTrytes);
                txObject.tag = txObject.obsoleteTag;
                txObject.attachmentTimestamp = Date.now();
                txObject.attachmentTimestampLowerBound = 0;
                txObject.attachmentTimestampUpperBound = MAX_TIMESTAMP_VALUE;
                // If this is the first transaction, to be processed
                // Make sure that it's the last in the bundle and then
                // assign it the supplied trunk and branch transactions
                if (!previousTxHash) {
                    // Check if last transaction in the bundle
                    if (txObject.lastIndex !== txObject.currentIndex) {
                        return callback(new Error("Wrong bundle order. The bundle should be ordered in descending order from currentIndex"));
                    }

                    txObject.trunkTransaction = trunkTransaction;
                    txObject.branchTransaction = branchTransaction;
                } else {
                    // Chain the bundle together via the trunkTransaction (previous tx in the bundle)
                    // Assign the supplied trunkTransaciton as branchTransaction
                    txObject.trunkTransaction = previousTxHash;
                    txObject.branchTransaction = trunkTransaction;
                }

                let newTrytes = iotaObj.utils.transactionTrytes(txObject);

                curl.pow({trytes: newTrytes, minWeight: minWeightMagnitude}).then(function(nonce) {
                    var returnedTrytes = newTrytes.substr(0, 2673-81).concat(nonce);
                    var newTxObject= iotaObj.utils.transactionObject(returnedTrytes);

                    // Assign the previousTxHash to this tx
                    var txHash = newTxObject.hash;
                    previousTxHash = txHash;

                    finalBundleTrytes.push(returnedTrytes);
                    callback(null);
                }).catch(callback);
            }
            loopTrytes()
        }

        ccurlHashing(trunkTransaction, branchTransaction, minWeightMagnitude, trytes, function(error, success) {
            if (error) {
                console.log(error);
            } else {
                console.log(success);
            }
            if (callback) {
                return callback(error, success);
            } else {
                return success;
            }
        })
    }

    function initializeIOTA() {
        eventEmitter.emitEvent('state', [`Initializing IOTA connection to ${getCurrentProvider()}`])
        iota = new iotaLib({'provider': getCurrentProvider()})
        // curl.overrideAttachToTangle(iota.api) // broken

        // using this because of bug with using curl.overrideAttachToTangle()
        iota.api.attachToTangle = localAttachToTangle
    }

    function sendMessages() {
        const transfers = generateTransfers()
        const transferCount = transfers.length
        const localConfirmationCount = transferCount * 2
        const transactionStartDate = Date.now()
        eventEmitter.emitEvent('state', [`Performing PoW (Proof of Work) on ${localConfirmationCount} transactions`])
        iota.api.sendTransfer(spamSeed, generateDepth(), weight, transfers, function(error, success){
            if (error) {
                eventEmitter.emitEvent('state', [`Error occurred while sending transactions: ${error}`])
                setTimeout(function(){
                    changeProviderAndSync()
                }, getNextErrorCooldown())
                return
            }
            const transactionEndDate = Date.now()
            const transactionDuration = transactionEndDate - transactionStartDate // milliseconds
            const oldTotalConfirmationDuration = averageConfirmationDuration * confirmationCount

            transactionCount += transferCount
            confirmationCount += localConfirmationCount
            averageConfirmationDuration = (oldTotalConfirmationDuration + transactionDuration) / confirmationCount

            eventEmitter.emitEvent('state', [`Completed PoW (Proof of Work) on ${localConfirmationCount} transactions`])
            eventEmitter.emitEvent('transactionCountChanged', [transactionCount])
            eventEmitter.emitEvent('confirmationCountChanged', [confirmationCount])
            eventEmitter.emitEvent('averageConfirmationDurationChanged', [averageConfirmationDuration])

            eventEmitter.emitEvent('transactionCompleted', [success])

            if(optionsProxy.isLoadBalancing) {
                eventEmitter.emitEvent('state', ['Changing nodes to balance the load'])
                return changeProviderAndSync()
            }

            checkIfNodeIsSynced()
        })
    }

    function getRandomProvider() {
        return validProviders[Math.floor(Math.random() * validProviders.length)]
    }

    function changeProviderAndSync() {
        eventEmitter.emitEvent('state', ['Randomly changing IOTA nodes'])
        _currentProvider = getRandomProvider()
        eventEmitter.emitEvent('state', [`New IOTA node: ${getCurrentProvider()}`])
        restartSpamming()
    }

    function checkIfNodeIsSynced() {
        eventEmitter.emitEvent('state', ['Checking if node is synced'])

        iota.api.getNodeInfo(function(error, success){
            if(error) {
                eventEmitter.emitEvent('state', ['Error occurred while checking if node is synced'])
                setTimeout(function(){
                    changeProviderAndSync()
                }, getNextErrorCooldown())
                return
            }

            const isNodeUnsynced =
                success.latestMilestone == spamSeed ||
                success.latestSolidSubtangleMilestone == spamSeed ||
                success.latestSolidSubtangleMilestoneIndex < success.latestMilestoneIndex

            const isNodeSynced = !isNodeUnsynced

            if(isNodeSynced) {
                eventEmitter.emitEvent('state', ['Node is synced'])
                sendMessages()
            } else {
                eventEmitter.emitEvent('state', [`Node is not synced. Trying again in ${globalErrorCooldown / 1000} seconds.`])
                setTimeout(function(){
                    changeProviderAndSync() // Sometimes the node stays unsynced for a long time, so change provider
                }, getNextErrorCooldown())
            }
        })
    }

    // Only call if there is an error or there is no current spamming running
    function restartSpamming() {
        eventEmitter.emitEvent('state', ['Restart transaction spamming'])
        initializeIOTA()
        checkIfNodeIsSynced()
    }

    // Helper for tritifying a URL.
    // WARNING: Not a perfect tritifier for URL's - only handles a few special characters
    function tritifyURL(urlString) {
        return urlString.replace(/:/gi, 'COLON').replace(/\./gi, 'DOT').replace(/\//gi, 'SLASH').replace(/-/gi, 'DASH').toUpperCase()
    }

    return {
        // Get options, or set options if params are specified
        options: function(params) {
            if(!params) {
                return {
                    provider: _currentProvider,
                    customProvider: customProvider,
                    depth: depth,
                    weight: weight,
                    spamSeed: spamSeed,
                    message: message,
                    tag: tag,
                    numberOfTransfersInBundle: numberOfTransfersInBundle,
                    isLoadBalancing: optionsProxy.isLoadBalancing
                }
            }
            if(params.hasOwnProperty("provider")) {
                _currentProvider = params.provider
                initializeIOTA()
            }
            if(params.hasOwnProperty("customProvider")) {
                customProvider = params.customProvider
                initializeIOTA()
            }
            if(params.hasOwnProperty("depth")) { depth = params.depth }
            if(params.hasOwnProperty("weight")) { weight = params.weight }
            if(params.hasOwnProperty("spamSeed")) { spamSeed = params.spamSeed }
            if(params.hasOwnProperty("message")) { message = params.message }
            if(params.hasOwnProperty("tag")) { tag = params.tag }
            if(params.hasOwnProperty("numberOfTransfersInBundle")) { numberOfTransfersInBundle = params.numberOfTransfersInBundle }
            if(params.hasOwnProperty("isLoadBalancing")) { optionsProxy.isLoadBalancing = params.isLoadBalancing }
        },
        startSpamming: function() {
            if(started) { return }
            started = true
            eventEmitter.emitEvent('state', ['Start transaction spamming'])
            restartSpamming()
        },
        stopSpamming: function() {
            // TODO
            console.error("stopSpamming() NOT IMPLEMENTED")
        },
        tritifyURL: tritifyURL,
        eventEmitter: eventEmitter, // TODO: emit an event when the provider randomly changes due to an error
        getTransactionCount: () => transactionCount,
        getConfirmationCount: () => confirmationCount,
        getAverageConfirmationDuration: () => averageConfirmationDuration,
        httpProviders: httpProviders,
        httpsProviders: httpsProviders,
        validProviders: validProviders,
    }
})()
