import { Map } from 'immutable'

import { serialization, type informant, type MetadataKey, type MetadataValue, type WeightsContainer, type TrainingInformant } from '../..'
import { type NodeID } from '../types'
import { Base as Client } from '../base'
import { type, type ClientConnected } from '../messages'
import { type EventConnection, waitMessageWithTimeout, WebSocketServer } from '../event_connection'
import * as messages from './messages'

/**
 * Client class that communicates with a centralized, federated server, when training
 * a specific task in the federated setting.
 */
export class Base extends Client {
  /**
   * Arbitrary node id assigned to the federated server which we are communicating with.
   * Indeed, the server acts as a node within the network. In the federated setting described
   * by this client class, the server is the only node which we are communicating with.
   */
  public static readonly SERVER_NODE_ID = 'federated-server-node-id'
  /**
   * Statistics curated by the federated server.
   */
  private receivedStatistics?: Record<string, number>
  /**
   * Map of metadata values for each node id.
   */
  private metadataMap?: Map<NodeID, MetadataValue>

  /**
   * Opens a new WebSocket connection with the server and listens to new messages over the channel
   */
  private async connectServer (url: URL): Promise<EventConnection> {
    const server: EventConnection = await WebSocketServer.connect(url, messages.isMessageFederated, messages.isMessageFederated)

    return server
  }

  /**
   * Initializes the connection to the server and get our own node id.
   * TODO: In the federated setting, should return the current server-side round
   * for the task.
   */
  async connect (): Promise<void> {
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

    serverURL.pathname += `feai/${this.task.id}`

    this._server = await this.connectServer(serverURL)
    this.aggregator.registerNode(Base.SERVER_NODE_ID)

    const msg: ClientConnected = {
      type: type.ClientConnected
    }
    this.server.send(msg)

    const received = await waitMessageWithTimeout(this.server, type.AssignNodeID)
    console.info(`[${received.id}] assign id generated by the server`)
    this._ownId = received.id
  }

  /**
   * Disconnection process when user quits the task.
   */
  async disconnect (): Promise<void> {
    this.server.disconnect()
    this._server = undefined
    this._ownId = undefined

    this.aggregator.setNodes(this.aggregator.nodes.delete(Base.SERVER_NODE_ID))
  }

  /**
   * Send a message containing our local weight updates to the federated server.
   * And waits for the server to reply with the most recent aggregated weights
   * @param weights The weight updates to send
   */
  private async sendPayloadAndReceiveResult (payload: WeightsContainer): Promise<WeightsContainer | undefined> {
    const msg: messages.SendPayload = {
      type: type.SendPayload,
      payload: await serialization.weights.encode(payload),
      round: this.aggregator.round
    }
    this.server.send(msg)
    // It is important than the client immediately awaits the server result or it may miss it
    return await this.receiveResult()
  }

  /**
   * Waits for the server's result for its current (most recent) round and add it to our aggregator.
   * Updates the aggregator's round if it's behind the server's.
   */
  private async receiveResult (): Promise<WeightsContainer | undefined> {
    try {
      const { payload, round } = await waitMessageWithTimeout(this.server, type.ReceiveServerPayload)
      const serverRound = round

      // Store the server result only if it is not stale
      if (this.aggregator.round <= round) {
        const serverResult = serialization.weights.decode(payload)
        // Update the local round to match the server's
        if (this.aggregator.round < serverRound) {
          this.aggregator.setRound(serverRound)
        }
        return serverResult
      }
    } catch (e) {
      console.error(e)
    }
  }

  /**
   * Pulls statistics curated by the federated server, which orchestrates the network
   * and produces the aggregation result, then display the relevant statistics via the
   * given training informant.
   * @param trainingInformant The training informant
   */
  async receiveStatistics (
    trainingInformant: informant.FederatedInformant
  ): Promise<void> {
    this.receivedStatistics = undefined

    const msg: messages.RequestServerStatistics = {
      type: type.RequestServerStatistics
    }
    this.server.send(msg)

    try {
      const received = await waitMessageWithTimeout(this.server, type.ReceiveServerStatistics)
      this.receivedStatistics = received.statistics
      trainingInformant.update(this.receivedStatistics)
    } catch (e) {
      console.error(e)
    }
  }

  /**
   * Sends metadata to the federated server. Metadata is gathered server-side according
   * to the key given by clients.
   * @param key The metadata key
   * @param value The metadata value
   */
  async sendMetadata (key: MetadataKey, value: MetadataValue): Promise<void> {
    const msg: messages.SendMetadata = {
      type: type.SendMetadata,
      taskId: this.task.id,
      nodeId: this.ownId,
      round: this.aggregator.round,
      key,
      value
    }

    this.server.send(msg)
  }

  /**
   * Fetch the metadata values maintained by the federated server, for a given metadata key.
   * The values are indexed by node id.
   * @param key The metadata key
   * @returns The map of node id to metadata value
   */
  async receiveMetadataMap (key: MetadataKey): Promise<Map<NodeID, MetadataValue> | undefined> {
    this.metadataMap = undefined

    const msg: messages.ReceiveServerMetadata = {
      type: type.ReceiveServerMetadata,
      taskId: this.task.id,
      nodeId: this.ownId,
      round: this.aggregator.round,
      key
    }

    this.server.send(msg)

    const received = await waitMessageWithTimeout(this.server, type.ReceiveServerMetadata)
    if (received.metadataMap !== undefined) {
      this.metadataMap = Map(
        received.metadataMap.filter(([k, v]) => v !== undefined) as Array<[NodeID, MetadataValue]>
      )
    }

    return this.metadataMap
  }

  async onRoundBeginCommunication (
    weights: WeightsContainer,
    round: number, informant:
    TrainingInformant
  ): Promise<void> {
    // Prepare the result promise for the incoming round
    this.aggregationResult = this.aggregator.receiveResult()
  }

  async onRoundEndCommunication (
    weights: WeightsContainer,
    round: number,
    trainingInformant: informant.FederatedInformant
  ): Promise<void> {
    // NB: For now, we suppose a fully-federated setting.

    if (this.aggregationResult === undefined) {
      throw new Error('local aggregation result was not set')
    }

    // Send our local contribution to the server
    // and receive the most recent weights as an answer to our contribution
    const serverResult = await this.sendPayloadAndReceiveResult(this.aggregator.makePayloads(weights).first())

    if (serverResult !== undefined && this.aggregator.add(Base.SERVER_NODE_ID, serverResult, round, 0)) {
      // Regular case: the server sends us its aggregation result which will serve our
      // own aggregation result.
    } else {
      // Unexpected case: for some reason, the server result is stale.
      // We proceed to the next round without its result.
      console.info(`[${this.ownId}] Server result is either stale or not received`)
      this.aggregator.nextRound()
    }

    // Pull statistics about the contributors
    // await this.receiveStatistics(trainingInformant)
  }

  async onTrainEndCommunication (): Promise<void> {}
}