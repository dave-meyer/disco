import { List, Set } from 'immutable'
import fs from 'node:fs/promises'
import tf from '@tensorflow/tfjs'
import '@tensorflow/tfjs-node'

import {
  Task, TaskProvider, isTask,
  serialization, models, Model
} from '@epfml/discojs'
import type { EncodedModel } from '@epfml/discojs'

/**
 * The TaskInitializer essentially handles initializing a Task and 
 * its associated EncodedModel.
 * 
 * We rely on a TaskInitializer to abstract the (asynchronous) logic of getting the model
 * when not provided.
 * Depending on the case, getting the model is done by reading the model files
 * from disk if they exists, downloading them from a URL or 
 * initializing the model from its architecture definition. 
 *  
 * We work with EncodedModels rather than Models because they are sent encoded 
 * to clients. Since the server doesn't need to use the Model, we
 * simply leave it already encoded and ready to be sent to clients
 * 
 * Due to the asynchronous nature of `addTask`, TaskInitializer is an EventEmitter, 
 * by registering callbacks on new tasks and emitting a 'newTask' event 
 * when a new task has been added.
 * 
 * Tasks are usually passed to TaskInitializer when booting the server
 * and objects depending on tasks and models can subscribe to 
 * the 'newTask' event to run callbacks whenever a new Task and EncodedModel are initialized.
 */
export class TaskInitializer {
  // List of callback to apply to future task-model pairs added
  private listeners = List<(t: Task, m: EncodedModel) => Promise<void>>()
  // Keep track of previously initialized task-model pairs
  #tasks = Set<[Task, EncodedModel]>()

  get tasks(): Set<[Task, EncodedModel]> {
    return this.#tasks
  }

  // Register a callback to be ran on all tasks
  on(_: 'newTask', callback: (t: Task, m: EncodedModel) => Promise<void>): void {
    // Apply the callback to already initialized task-model pairs
    this.#tasks.forEach(async ([t, m]) => { await callback(t, m) })
    // Register the callback that will be ran when new tasks are added
    this.listeners = this.listeners.push(callback)
  }

  // Emit a 'newTask' event, 
  // It runs all the registered callbacks with the new task and model
  #emit(_: 'newTask', task: Task, model: EncodedModel): void {
    // Run all the callbacks on the newly added task
    this.listeners.forEach(async (listener) => { await listener(task, model) })
  }

  /**
   * Method to add a new task and optionally its associated model.
   * It accepts parameters in different formats and handles 
   * shaping them into a Task and an EncodedModel.
   * The method emits a 'newTask' event with the resulting Task and EncodedModel.
   * 
   * If a Task and the EncodedModel is provided as parameters the method does change them
   * Otherwise the method handles shaping the parameters into a Task and EncodedModel 
   * before emitting the event
   * 
   * @param taskOrProvider either a Task or TaskProvider
   * @param model optional model, can already be an EncodedModel, a Model or a URL for the model
   */
  async addTask(taskOrProvider: Task | TaskProvider,
    model?: Model | URL | EncodedModel): Promise<void> {
    // get the task
    const task = isTask(taskOrProvider) ? taskOrProvider : taskOrProvider.getTask()

    // get the model
    let encodedModel: EncodedModel
    if (serialization.model.isEncoded(model)) {
      encodedModel = model // don't do anything if already encoded
    } else {
      let tfModel: Model
      if (model === undefined) { 
        // Get the model if nothing is provided
        tfModel = await this.loadModelFromTask(taskOrProvider)
      } else if (model instanceof URL) {
        // Downloading the model if a URL is given
        tfModel = new models.TFJS(await tf.loadLayersModel(model.href))
      } else if (model instanceof Model) {
        // Don't do anything if the model is already specified
        tfModel = model
      } else {
        throw new Error('invalid model')
      }
      encodedModel = await serialization.model.encode(tfModel)
    }

    // Add the task-model pair to the set
    this.#tasks = this.#tasks.add([task, encodedModel])
    this.#emit('newTask', task, encodedModel)
  }

  /**
   * Gets the model associated to a task. First checks if the model has been saved to disk.
   * Otherwise, initializes it from its architecture definition (and saves it to disk)
   * 
   * @param taskOrProvider either a Task or a TaskProvider
   * @returns a promise for the associated model
   */
  private async loadModelFromTask(taskOrProvider: Task | TaskProvider): Promise<Model> {
    const task = isTask(taskOrProvider) ? taskOrProvider : taskOrProvider.getTask()
    let model: Model | undefined
    
    const modelPath = `./models/${task.id}/`
    try {
      const content = await fs.readFile(`${modelPath}/model.json`)
      return await serialization.model.decode(content)
    } catch {
      // unable to read file (potentially doesn't exist), continuing
    }
    
    if (isTask(taskOrProvider)) {
      // if the model isn't already saved to disk then we need the TaskProvider
      // to get the model architecture definition
      throw new Error('saved model not found and no way to get it')
    } else {
      model = await taskOrProvider.getModel()
    }

    // Save the model to disk
    await fs.mkdir(modelPath, { recursive: true })
    const encoded = await serialization.model.encode(model)
    await fs.writeFile(`${modelPath}/model.json`, encoded)
    
    return model
  }
}