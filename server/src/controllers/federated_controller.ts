
import createDebug from "debug";
import WebSocket from 'ws'
import { v4 as randomUUID } from 'uuid'
import msgpack from 'msgpack-lite'
import { Map } from 'immutable'

import type { EncodedWeights, Task, WeightsContainer } from '@epfml/discojs'
import {
  aggregator as aggregators,
  client,
  serialization,
} from '@epfml/discojs'

import { TrainingController } from "./training_controller.js";

import MessageTypes = client.messages.type
import FederatedMessages = client.federated.messages

const debug = createDebug("server:controllers:federated")

export class FederatedController extends TrainingController {
  /**
   * Aggregators for each hosted task.
    By default the server waits for 100% of the nodes to send their contributions before aggregating the updates
   */
  #aggregator = new aggregators.MeanAggregator(undefined, 1, 'relative')
  /**
   * Promise containing the current round's results. To be awaited on when providing clients
   * with the most recent result.
   */
  #result: Promise<WeightsContainer> | undefined = undefined
  /**
   * The most up to date global weights. The model weights are already serialized and 
   * can be sent to participants, before starting training, or when joining mid-training 
   * or staled participants
   */
  #latestGlobalWeights: EncodedWeights
  /**
   * Boolean used to know if we have enough participants to train or if 
   * we should be waiting for more
   */
  #waitingForMoreParticipants = true
  /**
   * List of active participants along with their websockets
   * the list allows updating participants about the training status 
   * i.e. waiting for more participants or resuming training
   */
  #participants = Map<string, WebSocket>()

  constructor(task: Task, initialWeights: EncodedWeights) {
    super(task)
    this.#latestGlobalWeights = initialWeights
    // start the perpetual promise loop
    void this.storeAggregationResult()
  }
  /**
   * Loop creating an aggregation result promise at each round.
   * Because clients contribute to the round asynchronously, a promise is used to let them wait
   * until the server has aggregated the weights. This loop creates a promise whenever the previous
   * one resolved and awaits until it resolves. The promise is used in createPromiseForWeights.
   * @param aggregator The aggregation handler
   */
  private async storeAggregationResult (): Promise<void> {
    // Create a promise on the future aggregated weights
    // Store the promise such that it is accessible from other methods
    this.#result = new Promise<WeightsContainer>((resolve) => this.#aggregator.once('aggregation', resolve))
    // The promise resolves once the server received enough contributions (through the handle method)
    // and the aggregator aggregated the weights.
    const globalModel = await this.#result
    const serializedWeights =  await serialization.weights.encode(globalModel)
    this.#latestGlobalWeights = serializedWeights

    // Create a new promise for the next round
    // TODO weird usage, should be handled inside of aggregator
    void this.storeAggregationResult()
  }

  /**
   * This method is called after received a local update.
   * It puts the client on hold until the server has aggregated the weights
   * by creating a Promise which will resolve once the server has received
   * enough contributions. Relying on a promise is useful since clients may
   * send their contributions at different times and a promise lets the server
   * wait asynchronously for the results
   *
   * @param task the task to which the client is contributing
   * @param aggregator the server aggregator, in order to access the current round
   * @param ws the websocket through which send the aggregated weights
   */
  private createPromiseForWeights (ws: WebSocket): void {
    const promisedResult = this.#result
    if (promisedResult === undefined) {
      throw new Error(`result promise was not set`)
    }

    // Wait for aggregation result to resolve with timeout, giving the network a time window
    // to contribute to the model
    void Promise.race([
      promisedResult,
      client.timeout(30_000, "Timeout while waiting for enough participant contributions") //TODO: it doesn't make sense that the server is using the client utils' timeout 
      ]).then((result) =>
        [result, this.#aggregator.round] as [WeightsContainer, number])
        .then(async ([result, round]) =>
          [await serialization.weights.encode(result), round] as [serialization.weights.Encoded, number])
        .then(([serialized, round]) => {
          debug("Sending global weights for round %o", round)
        const msg: FederatedMessages.ReceiveServerPayload = {
          type: MessageTypes.ReceiveServerPayload,
          round, // send the current round number after aggregation
          payload: serialized,
          nbOfParticipants: this.#participants.size
        }
        ws.send(msgpack.encode(msg))
      })
      .catch((e) => debug("while waiting for weights: %o", e))
  }

  /**
   * This is the main logic of the federated server. This method is called only once per
   * websocket connection (i.e. each participant) along with the associated task.
   * It registers what the server will do upon receiving messages from the participant.
   * Note that `this.handle` is only called once to setup the logic. It is `ws.on()`
   * that is called upon receiving messages (and not `this.handle`)
   * 
   * @param task the task associated with the current websocket (= participant)
   * @param ws the websocket connection through which the participant and the server communicate
   */
  handle(ws: WebSocket): void {
    const minNbOfParticipants = this.task.trainingInformation.minNbOfParticipants
    this.#aggregator.minNbOfParticipants = minNbOfParticipants
    // Try generating a new Client id until there no collision with existing ones
    let clientId = randomUUID()
    while (!this.#aggregator.registerNode(clientId)) {
      clientId = randomUUID()
    }

    // Setup callbacks triggered upon receiving the different client messages
    ws.on('message', (data: Buffer) => {
      const msg: unknown = msgpack.decode(data)
      if (!FederatedMessages.isMessageFederated(msg)) {
        debug("invalid federated message received on WebSocket: %o", msg);
        return // TODO send back error
      }

      // Currently expect two types of messages from clients: 
      // - a client connects to the task
      // - a client sends a weight update
      switch (msg.type) {
        /* 
        * A new participant joins the task 
        */
        case MessageTypes.ClientConnected: {
          debug(`client [%s] joined ${this.task.id}`, clientId.slice(0, 4))
          this.#participants = this.#participants.set(clientId, ws) // add the new client

          const waitForMoreParticipants = this.#participants.size < minNbOfParticipants
          const msg: FederatedMessages.NewFederatedNodeInfo = {
            type: MessageTypes.NewFederatedNodeInfo,
            id: clientId,
            waitForMoreParticipants,
            payload: this.#latestGlobalWeights,
            round: this.#aggregator.round,
            nbOfParticipants: this.#participants.size
          }
          ws.send(msgpack.encode(msg))

          debug("Wait for more participant flag: %o", waitForMoreParticipants)
          
          // If we were previously waiting for more participants to join and we now have enough,
          // broadcast to previously waiting participants that the training can start
          if (this.#waitingForMoreParticipants && !waitForMoreParticipants) {
            this.#participants
              // filter out the client that just joined as 
              // it already knows via the NewFederatedNodeInfo message
              .filter((_, id) => id !== clientId)
              .forEach((participantWs, participantId) => {
                debug("Sending enough-participant message to client [%s]", participantId.slice(0, 4))
                const msg: FederatedMessages.EnoughParticipants = {
                  type: MessageTypes.EnoughParticipants
                }
                participantWs.send(msgpack.encode(msg))
              })
          }
          this.#waitingForMoreParticipants = waitForMoreParticipants // update the attribute
          break
        }
        /* 
        * A client sends a weight update to the server
        */
        case MessageTypes.SendPayload: {
          const { payload, round } = msg
          if (this.#aggregator.isValidContribution(clientId, round)) {
            // We need to create a promise waiting for the global model before adding the contribution to the aggregator
            // (so that the aggregation and sending the global model to participants
            // doesn't happen before the promise is created)
            this.createPromiseForWeights(ws)
            // This is assuming that the federated server's aggregator
            // always works with a single communication round
            const weights = serialization.weights.decode(payload)
            const addedSuccessfully = this.#aggregator.add(clientId, weights, round)
            if (!addedSuccessfully) throw new Error("Aggregator's isValidContribution returned true but failed to add the contribution")
            debug(`Successfully added contribution from client [%s] for round ${round}`, clientId.slice(0, 4))
          } else {
            // If the client sent an invalid or outdated contribution
            // the server answers with the current round and last global model update
            debug(`Dropped contribution from client [%s] for round ${round} ` +
              `Sending last global model from round ${this.#aggregator.round - 1}`, clientId.slice(0, 4))
            // no latest model at the first round
            if (this.#latestGlobalWeights === undefined) return
            
            const msg: FederatedMessages.ReceiveServerPayload = {
              type: MessageTypes.ReceiveServerPayload,
              round: this.#aggregator.round - 1, // send the model from the previous round
              payload: this.#latestGlobalWeights,
              nbOfParticipants: this.#participants.size
            }
            ws.send(msgpack.encode(msg))
          }
          break
        }
      }
    })

    // Setup callback for client leaving the session
    ws.on('close', () => {
      // Remove the participant when the websocket is closed
      this.#participants = this.#participants.delete(clientId)
      this.#aggregator.removeNode(clientId)
      debug("client [%s] left", clientId.slice(0, 4))

      // Check if we dropped below the minimum number of participant required
      // or if we are already waiting for new participants to join
      if (this.#participants.size >= minNbOfParticipants ||
        this.#waitingForMoreParticipants
      ) return

      this.#waitingForMoreParticipants = true
      // Tell remaining participants to wait until more participants join
      this.#participants
        .forEach((participantWs, participantId) => {
          debug("Telling remaining client [%s] to wait for participants", participantId.slice(0, 4))
          const msg: FederatedMessages.WaitingForMoreParticipants = {
            type: MessageTypes.WaitingForMoreParticipants
          }
          participantWs.send(msgpack.encode(msg))
        })
    }) 
  }
}