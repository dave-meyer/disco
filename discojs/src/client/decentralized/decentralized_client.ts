import createDebug from "debug";
import { Map, Set } from 'immutable'

import type { Model, WeightsContainer } from "../../index.js";
import { serialization } from "../../index.js";
import { Client, type NodeID } from '../index.js'
import { type, type ClientConnected } from '../messages.js'
import { timeout } from '../utils.js'
import { WebSocketServer, waitMessage, type PeerConnection, waitMessageWithTimeout } from '../event_connection.js'
import { PeerPool } from './peer_pool.js'
import * as messages from './messages.js'

const debug = createDebug("discojs:client:decentralized");

/**
 * Represents a decentralized client in a network of peers. Peers coordinate each other with the
 * help of the network's server, yet only exchange payloads between each other. Communication
 * with the server is based off regular WebSockets, whereas peer-to-peer communication uses
 * WebRTC for Node.js.
 */
export class DecentralizedClient extends Client {
  /**
   * The pool of peers to communicate with during the current training round.
   */
  private pool?: PeerPool
  private connections?: Map<NodeID, PeerConnection>
  
  // Used to handle timeouts and promise resolving after calling disconnect
  private get isDisconnected() : boolean {
    return this._server === undefined
  }
  
  /**
   * Public method called by disco.ts when starting training. This method sends
   * a message to the server asking to join the task and be assigned a client ID.
   * 
   * The peer also establishes a WebSocket connection with the server to then 
   * create peer-to-peer WebRTC connections with peers. The server is used to exchange
   * peers network information.
   */
  async connect(): Promise<Model> {
    const model = await super.connect()  // Get the server base model
    const serverURL = new URL('', this.url.href)
    switch (this.url.protocol) {
      case 'http:':
        serverURL.protocol = 'ws:'
        break
      case 'https:':
        serverURL.protocol = 'wss:'
        break
      default:
        throw new Error(`unknown protocol: ${this.url.protocol}`)
    }
    serverURL.pathname += `decentralized/${this.task.id}`
    // Create a WebSocket connection with the server
    // The client then waits for the server to forward it other client's network information.
    // Upon receiving other peer's information, the clients establish a peer-to-peer WebRTC connection.
    this._server = await WebSocketServer.connect(serverURL, messages.isMessageFromServer, messages.isMessageToServer)
    this.server.on(type.SignalForPeer, (event) => {
      if (this.pool === undefined) throw new Error('received signal but peer pool is undefined')
      // Create a WebRTC connection with the peer
      this.pool.signal(event.peer, event.signal)
    })

    // c.f. setupServerCallbacks doc for explanation
    let receivedEnoughParticipants = false
    this.setupServerCallbacks(() => receivedEnoughParticipants = true)
    
    const msg: ClientConnected = {
      type: type.ClientConnected
    }
    this.server.send(msg)
    
    const { id, waitForMoreParticipants } = await waitMessage(this.server, type.NewDecentralizedNodeInfo)

    // This should come right after receiving the message to make sure
    // we don't miss a subsequent message from the server
    // We check if the server is telling us to wait for more participants
    // and we also check if a EnoughParticipant message ended up arriving
    // before the NewNodeInfo
    if (waitForMoreParticipants && !receivedEnoughParticipants) {
      // Create a promise that resolves when enough participants join
      // The client will await this promise before sending its local weight update
      this.promiseForMoreParticipants = this.createPromiseForMoreParticipants()
    }

    debug(`[${this.shortId(id)}] assigned id generated by server`);

    if (this._ownId !== undefined) {
      throw new Error('received id from server but was already received')
    }
    this._ownId = id
    this.pool = new PeerPool(id)

    return model
  }

  async disconnect (): Promise<void> {
    // Disconnect from peers
    await this.pool?.shutdown()
    this.pool = undefined

    if (this.connections !== undefined) {
      const peers = this.connections.keySeq().toSet()
      this.aggregator.setNodes(this.aggregator.nodes.subtract(peers))
    }
    // Disconnect from server
    await this.server?.disconnect()
    this._server = undefined
    this._ownId = undefined
    
    return Promise.resolve()
  }

  /**
   * At the beginning of a round, each peer tells the server it is ready to proceed
   * The server answers with the list of all peers connected for the round
   * Given the list, the peers then create peer-to-peer connections with each other.
   * When connected, one peer creates a promise for every other peer's weight update
   * and waits for it to resolve.
   * 
   */
  override async onRoundBeginCommunication (): Promise<void> {
    if (this.server === undefined) {
      throw new Error("peer's server is undefined, make sure to call `client.connect()` first")
    } if (this.pool === undefined) {
        throw new Error('peer pool is undefined, make sure to call `client.connect()` first')
    }
    // First we check if we are waiting for more participants before sending our weight update
    await this.checkIfWaitForParticipants()
    // Save the status in case participants leave and we switch to waiting for more participants
    // Once enough new participants join we can display the previous status again
    this.saveAndEmit("RETRIEVING PEERS")

    // Reset peers list at each round of training to make sure client works with an updated peers
    // list, maintained by the server. Adds any received weights to the aggregator.
    // Tell the server we are ready for the next round
    const readyMessage: messages.PeerIsReady = { type: type.PeerIsReady }
    this.server.send(readyMessage)

    // Wait for the server to answer with the list of peers for the round
    try {
      debug(`[${this.shortId(this.ownId)}] is waiting for peer list for round ${this.aggregator.round}`);
      const receivedMessage = await waitMessage(this.server, type.PeersForRound)
      
      const peers = Set(receivedMessage.peers)

      if (this.ownId !== undefined && peers.has(this.ownId)) {
        throw new Error('received peer list contains our own id')
      }
      // Store the list of peers for the current round including ourselves
      this.aggregator.setNodes(peers.add(this.ownId))

      // Initiate peer to peer connections with each peer
      // When connected, create a promise waiting for each peer's round contribution
      const connections = await this.pool.getPeers(
        peers,
        this.server,
        // Init receipt of peers weights this awaits the peer's
        // weight update and adds it to our aggregator upon reception
        (conn) => this.receivePayloads(conn)
      )

      debug(`[${this.shortId(this.ownId)}] received peers for round ${this.aggregator.round}: %o`, connections.keySeq().toJS());
      this.connections = connections
    } catch (e) {
      debug(`Error for [${this.shortId(this.ownId)}] while beginning round: %o`, e);
      this.aggregator.setNodes(Set(this.ownId))
      this.connections = Map()
    }

    // Store the promise for the current round's aggregation result.
    // We will await for it to resolve at the end of the round when exchanging weight updates.
    this.aggregationResult = new Promise((resolve) => this.aggregator.once('aggregation', resolve))
    this.saveAndEmit("TRAINING")
  }

  /**
   * At each communication rounds, awaits peers contributions and add them to the client's aggregator.
   * This method is used as callback by getPeers when connecting to the rounds' peers
   * @param connections 
   * @param round 
   */
  private receivePayloads (connections: Map<NodeID, PeerConnection>): void {
    connections.forEach(async (connection, peerId) => {
      debug(`waiting for peer ${peerId}`);
      for (let _ = 0; _ < this.aggregator.communicationRounds; _++) {
        try {
          const message = await waitMessageWithTimeout(connection, type.Payload,
            60_000, "Timeout waiting for a contribution from peer " + peerId)
          const decoded = serialization.weights.decode(message.payload)

          if (!this.aggregator.isValidContribution(peerId, message.aggregationRound)) {
            debug(`[${this.shortId(this.ownId)}] failed to add contribution from peer ${this.shortId(peerId)}`);  
          }
          else {
            debug(`[${this.shortId(this.ownId)}] received payload from peer ${this.shortId(peerId)}` +
              ` for round (%d, %d)`, message.aggregationRound, message.communicationRound);
            // Make sure to not await this promise in order to not miss subsequent messages
            void this.aggregator.add(peerId, decoded, message.communicationRound)
              .then(() =>
                debug(`[${this.shortId(this.ownId)}] aggregated the model` +
                  ` for round (%d, %d)`, message.aggregationRound, message.communicationRound)
              )
          }
        } catch (e) {
          if (this.isDisconnected) return
          debug(`Error for [${this.shortId(this.ownId)}] while receiving payloads: %o`, e);
        }
      }
    })
  }

  override async onRoundEndCommunication (weights: WeightsContainer): Promise<WeightsContainer> {
    if (this.aggregationResult === undefined) {
      throw new TypeError('aggregation result promise is undefined')
    }
    // First we check if we are waiting for more participants before sending our weight update
    await this.checkIfWaitForParticipants()
    this.saveAndEmit("UPDATING MODEL")

    // Perform the required communication rounds. Each communication round consists in sending our local payload,
    // followed by an aggregation step triggered by the receipt of other payloads, and handled by the aggregator.
    // A communication round's payload is the aggregation result of the previous communication round. The first
    // communication round simply sends our training result, i.e. model weights updates. This scheme allows for
    // the aggregator to define any complex multi-round aggregation mechanism.
    let result = weights;
    for (let communicationRound = 0; communicationRound < this.aggregator.communicationRounds; communicationRound++) {
      // Generate our payloads for this communication round and send them to all ready connected peers
      if (this.connections !== undefined) {
        const payloads = this.aggregator.makePayloads(result)
        try {
          await Promise.all(payloads.map(async (payload, id) => {
            if (id === this.ownId)
              return this.aggregator.add(this.ownId, payload, communicationRound)
            
            const peer = this.connections?.get(id)
            if (peer !== undefined) {
              const encoded = await serialization.weights.encode(payload)
              const msg: messages.PeerMessage = {
                type: type.Payload,
                peer: id,
                aggregationRound: this.aggregator.round,
                communicationRound,
                payload: encoded
              }
              peer.send(msg)
              debug(`[${this.shortId(this.ownId)}] send weight update to peer ${this.shortId(msg.peer)}` +
              ` for round (%d, %d)`, this.aggregator.round, communicationRound);
            }
          }))
        } catch (cause) {
          throw new Error('error while sending weights', { cause })
        }
      }
      // Wait for aggregation before proceeding to the next communication round.
      // The current result will be used as payload for the eventual next communication round.
      try { 
        result = await Promise.race([
          this.aggregationResult,
          timeout(undefined, "Timeout waiting on the aggregation result promise to resolve")
        ])
      } catch (e) {
        if (this.isDisconnected) {
          return weights
        }
        debug(`[${this.shortId(this.ownId)}] while waiting for aggregation: %o`, e);
        break
      }

      // There is at least one communication round remaining
      if (communicationRound < this.aggregator.communicationRounds - 1) {
        // Reuse the aggregation result
        this.aggregationResult = new Promise((resolve) => this.aggregator.once('aggregation', resolve))
      }
    }

    // Reset the peers list for the next round
    this.aggregator.resetNodes()

    return await this.aggregationResult
  }
}
