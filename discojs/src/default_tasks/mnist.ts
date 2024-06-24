import * as tf from '@tensorflow/tfjs'

import type { Model, Task, TaskProvider } from '../index.js'
import { data, models } from '../index.js'

export const mnist: TaskProvider = {
  getTask (): Task {
    return {
      id: 'mnist',
      displayInformation: {
        taskTitle: 'MNIST',
        summary: {
          preview: "The MNIST handwritten digit classification problem is a standard dataset used in computer vision and deep learning.",
          overview: "Download the classic MNIST dataset of hand-written numbers <a class='underline text-primary-dark dark:text-primary-light' href='https://www.kaggle.com/scolianni/mnistasjpg'>here</a>."
        },
        model: "The model is a simple Convolutional Neural Network composed of three convolutional layers with ReLU activations and max pooling layers, followed by two fully connected layers. The data preprocessing reshapes images into 28x28 pixels and normalizes values between 0 and 1. The data preprocessing reshapes images into 224x224 pixels and normalizes values between 0 and 1. The neural network is optimized via RMSProp and a categorical Cross Entropy loss.",
        dataFormatInformation: 'This model is trained on images corresponding to digits 0 to 9. You can upload each digit image of your dataset in the box corresponding to its label. The model taskes images of size 28x28 as input.',
        dataExampleText: 'Below you can find an example of an expected image representing the digit 9.',
        dataExampleImage: 'http://storage.googleapis.com/deai-313515.appspot.com/example_training_data/9-mnist-example.png',
        sampleDatasetLink: 'https://storage.googleapis.com/deai-313515.appspot.com/MNIST_samples.tar.gz',
        sampleDatasetInstructions: 'Opening the link should start downloading a zip file which you can unzip. You can connect the data with the CSV option below using the CSV file named "mnist_labels.csv". After selecting in the CSv file, you will be able to connect the data under in the "images" folder.'
      },
      trainingInformation: {
        modelID: 'mnist-model',
        epochs: 20,
        roundDuration: 10,
        validationSplit: 0.2,
        batchSize: 30,
        dataType: 'image',
        IMAGE_H: 28,
        IMAGE_W: 28,
        preprocessingFunctions: [data.ImagePreprocessing.Resize, data.ImagePreprocessing.Normalize],
        LABEL_LIST: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        scheme: 'decentralized',
        noiseScale: undefined,
        clippingRadius: 20,
        decentralizedSecure: true,
        minimumReadyPeers: 3,
        maxShareValue: 100,
        tensorBackend: 'tfjs'
      }
    }
  },

  getModel (): Promise<Model> {
    const model = tf.sequential()

    model.add(
      tf.layers.conv2d({
        inputShape: [28, 28, 3],
        kernelSize: 3,
        filters: 16,
        activation: 'relu'
      })
    )
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }))
    model.add(
      tf.layers.conv2d({ kernelSize: 3, filters: 32, activation: 'relu' })
    )
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }))
    model.add(
      tf.layers.conv2d({ kernelSize: 3, filters: 32, activation: 'relu' })
    )
    model.add(tf.layers.flatten({}))
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }))
    model.add(tf.layers.dense({ units: 10, activation: 'softmax' }))

    model.compile({
      optimizer: 'rmsprop',
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    })

    return Promise.resolve(new models.TFJS(model))
  }
}
