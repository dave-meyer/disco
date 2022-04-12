class DataExample {
  columnName: string
  columnData: string | number
}

class ModelCompileData {
  optimizer: string
  loss: string
  metrics: string[]
}

export class TrainingInformation {
  modelID: string
  epochs: number
  roundDuration: number
  validationSplit: number
  batchSize: number
  preprocessFunctions: string[]
  modelCompileData: ModelCompileData
  receivedMessagesThreshold?: number
  dataType: string
  inputColumns?: string[]
  outputColumns?: string[]
  threshold?: number
  IMAGE_H?: number
  IMAGE_W?: number
  LABEL_LIST?: string[]
  aggregateImagesById?: boolean
  learningRate?: number
  NUM_CLASSES?: number
  csvLabels?: boolean
  RESIZED_IMAGE_H?: number
  RESIZED_IMAGE_W?: number
  LABEL_ASSIGNMENT?: DataExample[]
  scheme?: string
}

export class DisplayInformation {
  taskTitle: string
  summary: string
  overview: string
  model?: string
  tradeoffs: string
  dataFormatInformation: string
  dataExampleText: string
  dataExample?: DataExample[]
  headers?: string[]
  dataExampleImage?: string
  limitations?: string
}

export class Task {
  taskID: string
  displayInformation: DisplayInformation
  trainingInformation: TrainingInformation

  constructor (taskID: string, displayInformation: DisplayInformation, trainingInformation: TrainingInformation) {
    this.taskID = taskID
    this.displayInformation = displayInformation
    this.trainingInformation = trainingInformation
  }
}
