import * as msgpack from 'msgpack-lite';
import { makeID, serializeWeights } from '../helpers';
import { getSuccessfulResponse } from './helpers';
import { Client } from '../client';
import * as api from './api';

/**
 * The waiting time between performing requests to the centralized server.
 * Expressed in milliseconds.
 */
const TIME_PER_TRIES = 1000;
/**
 * The maximum number of tries before stopping to perform requests.
 */
const MAX_TRIES = 30;

/**
 * Class that deals with communication with the centralized server when training
 * a specific task.
 */
export class FederatedClient extends Client {
  /**
   * Prepares connection to a centralized server for training a given task.
   * @param {String} serverURL The URL of the centralized server.
   * @param {Task} task The associated task object.
   * @param {Number} round The training round.
   */
  constructor(serverURL, task) {
    super(serverURL, task);
    this.clientID = null;
    this.round = 0;
    this.selected = false;
  }

  /**
   * Initialize the connection to the server. TODO: In the case of FeAI,
   * should return the current server-side round for the task.
   */
  async connect() {
    /**
     * Create an ID used to connect to the server.
     * The client is now considered as connected and further
     * API requests may be made.
     */
    this.clientID = makeID(10);
    const response = await api.connect(this.task.taskID, this.clientID);
    return response.ok;
  }

  /**
   * Disconnection process when user quits the task.
   */
  async disconnect() {
    const response = await api.disconnect(this.task.taskID, this.clientID);
    return response.ok;
  }

  async selectionStatus() {
    const response = await api.selectionStatus(this.task.taskID, this.clientID);
    return response.ok ? await response.json() : undefined;
  }

  /**
   * Requests the aggregated weights from the centralized server,
   * for the given epoch
   * @returns The aggregated weights for the given epoch.
   */
  async aggregationStatus() {
    const response = await api.aggregationStatus(
      this.task.taskID,
      this.round,
      this.clientID
    );
    return response.ok ? await response.json() : undefined;
  }

  async postWeights(weights) {
    const encodedWeights = msgpack.encode(
      Array.from(await serializeWeights(weights))
    );
    const response = await api.postWeights(
      this.task.taskID,
      this.round,
      this.clientID,
      encodedWeights
    );
    return response.ok;
  }

  async postSamples(samples) {
    const response = api.postSamples(
      this.task.taskID,
      this.round,
      this.clientID,
      samples
    );
    return response.ok;
  }

  async getSamplesMap() {
    const response = await api.getSamplesMap(
      this.task.taskID,
      this.round,
      this.clientID
    );
    if (response.ok) {
      const body = await response.json();
      return new Map(msgpack.decode(body.samples));
    } else {
      return new Map();
    }
  }

  async _getSelected() {
    /**
     * Wait for the selection status from server.
     */
    const selectionStatus = await getSuccessfulResponse(
      api.selectionStatus,
      'selected',
      MAX_TRIES,
      TIME_PER_TRIES,
      this.task.taskID,
      this.clientID
    );
    /**
     * This should not happen if the waiting process above is done right.
     * One should definitely define a behavior to make the app robust.
     * For example, fallback to local training.
     */
    if (!(selectionStatus && selectionStatus.selected)) {
      throw Error('Not implemented');
    }
    /**
     * Proceed to the training round.
     */
    this.selected = true;
    this.round = selectionStatus.round;
  }

  /*async onTrainBeginCommunication(model, trainingInformant) {
    super.onTrainBeginCommunication(model, trainingInformant);
    await this._getSelected();
  }*/

  async onEpochBeginCommunication(model, epoch, trainingInformant) {
    super.onEpochBeginCommunication(model, epoch, trainingInformant);
    const startOfRound =
      (epoch + 1) % this.task.trainingInformation.roundDuration === 1;
    if (startOfRound) {
      await this._getSelected();
    }
  }

  async onEpochEndCommunication(model, epoch, trainingInformant) {
    super.onEpochEndCommunication(model, epoch, trainingInformant);

    /**
     * Ensure this was the last epoch of a round.
     */
    const endOfRound =
      epoch > 1 &&
      (epoch + 1) % this.task.trainingInformation.roundDuration === 1;
    if (!endOfRound) {
      return;
    }

    /**
     * Once the training round is completed, send local weights to the
     * server for aggregation.
     */
    await this.postWeights(model.weights);
    /**
     * Wait for the server to proceed to weights aggregation.
     */
    const aggregationStatus = await getSuccessfulResponse(
      api.aggregationStatus,
      'aggregated',
      MAX_TRIES,
      TIME_PER_TRIES,
      this.task.taskID,
      this.round,
      this.clientID
    );
    /**
     * This should not happen if the waiting process above is done right.
     * One should definitely define a behavior to make the app robust.
     * For example, fallback to local training.
     */
    if (!(aggregationStatus && aggregationStatus.aggregated)) {
      throw Error('Not implemented');
    }
    /**
     * Update local weights with the most recent model stored on server.
     */
    this.selected = false;
    model = this.task.createModel();
  }
}
